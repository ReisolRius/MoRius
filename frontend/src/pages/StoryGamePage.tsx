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
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type Ref,
} from 'react'
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete'
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
import cardsCharactersTabIconMarkup from '../assets/icons/cards-characters.svg?raw'
import cardsPlotTabIconMarkup from '../assets/icons/cards-plot.svg?raw'
import cardsRulesTabIconMarkup from '../assets/icons/cards-rules.svg?raw'
import cardsWorldTabIconMarkup from '../assets/icons/cards-world.svg?raw'
import composerGenerateImageIcon from '../assets/icons/generateimage.svg'
import composerRegenerateImageIcon from '../assets/icons/regenerateimag.svg'
import environmentCloudIcon from '../assets/icons/environment-cloud.svg'
import environmentClearIcon from '../assets/icons/environment-clear.svg'
import environmentFogIcon from '../assets/icons/environment-fog.svg'
import environmentSnowIcon from '../assets/icons/environment-snow.svg'
import environmentUnderwaterIcon from '../assets/icons/environment-underwater.svg'
import aiEditIconMarkup from '../assets/icons/custom/ai-edit.svg?raw'
import clockMemoryIcon from '../assets/icons/custom/clock.svg'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import CharacterNoteBadge from '../components/characters/CharacterNoteBadge'
import CharacterShowcaseCard from '../components/characters/CharacterShowcaseCard'
import ImageCropper from '../components/ImageCropper'
import HeaderAccountActions from '../components/HeaderAccountActions'
import AdvancedRegenerationDialog from '../components/story/AdvancedRegenerationDialog'
import WorldCardBannerPreview from '../components/story/WorldCardBannerPreview'
import WorldCardTemplatePickerDialog from '../components/story/WorldCardTemplatePickerDialog'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import BaseDialog from '../components/dialogs/BaseDialog'
import ConfirmLogoutDialog from '../components/profile/ConfirmLogoutDialog'
import PaymentSuccessDialog from '../components/profile/PaymentSuccessDialog'
import ProfileDialog from '../components/profile/ProfileDialog'
import TextLimitIndicator from '../components/TextLimitIndicator'
import TopUpDialog from '../components/profile/TopUpDialog'
import ProgressiveAvatar from '../components/media/ProgressiveAvatar'
import ProgressiveImage from '../components/media/ProgressiveImage'
import ThemedSvgIcon from '../components/icons/ThemedSvgIcon'
import { resolveApiResourceUrl } from '../services/httpClient'
import { OPEN_CHARACTER_MANAGER_FLAG_KEY, QUICK_START_WORLD_STORAGE_KEY } from '../constants/storageKeys'
import {
  createCoinTopUpPayment,
  getOnboardingGuideState,
  getCoinTopUpPlans,
  syncCoinTopUpPayment,
  updateCurrentUserAvatar,
  updateCurrentUserProfile,
  type CoinTopUpPlan,
} from '../services/authApi'
import {
  addCommunityCharacter,
  createStoryCharacterRace,
  createStoryWorldDetailType,
  createStoryCharacter,
  listStoryWorldDetailTypes,
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
  listStoryCharacterRaces,
  listStoryCharacters,
  listStoryGames,
  optimizeStoryMemory,
  regenerateStoryEnvironmentWeather,
  selectStoryMainHero,
  updateStoryCharacter,
  updateStoryGameMeta,
  updateStoryGameSettings,
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
  StoryCharacterEmotionAssets,
  StoryCharacterEmotionId,
  StoryCharacterRace,
  StorySceneEmotionCue,
  StorySceneEmotionCueParticipant,
  StoryCommunityCharacterSummary,
  StoryGameSummary,
  StoryInstructionCard,
  StoryInstructionTemplate,
  StoryImageModelId,
  StoryMemoryBlock,
  StoryMemoryOptimizationMode,
  StoryMessage,
  StoryNarratorModelId,
  StoryPlotCard,
  StoryPlotCardEvent,
  StoryStreamDonePayload,
  StoryWorldCard,
  StoryWorldCardKind,
  StoryWorldDetailType,
  StoryWorldCardEvent,
  SmartRegenerationMode,
  SmartRegenerationOption,
} from '../types/story'
import { rememberLastPlayedGameCard } from '../utils/mobileQuickActions'
import {
  createSmoothStreamingTextController,
  prefersReducedMotion,
  readSmoothStreamingPreference,
  writeSmoothStreamingPreference,
  type SmoothStreamingTextController,
} from '../utils/smoothStreamingText'
import { MobileCardItem } from '../components/mobile/MobileCardSlider'
import { buildWorldFallbackArtwork } from '../utils/worldBackground'
import {
  prepareAvatarPayloadForRequest,
} from '../utils/avatar'
import {
  buildStoryWorldDetailTypeSuggestions,
  normalizeStoryWorldDetailTypeValue,
  STORY_WORLD_BANNER_ASPECT,
} from '../utils/storyWorldCards'
import {
  DEFAULT_SMART_REGENERATION_MODE,
  resolveSmartRegenerationOptionSelection,
} from '../utils/advancedRegeneration'
import { moriusThemeTokens, useMoriusThemeController } from '../theme'

type StoryGamePageProps = {
  user: AuthUser
  authToken: string
  initialGameId: number | null
  onNavigate: (path: string) => void
  onLogout: () => void
  onUserUpdate: (user: AuthUser) => void
}

type WorldDetailTypeAutocompleteOption = {
  label: string
  value: string
  isCreateAction?: boolean
}

type StorySettingsOverride = {
  storyLlmModel: StoryNarratorModelId
  responseMaxTokens: number
  responseMaxTokensEnabled: boolean
  memoryOptimizationEnabled: boolean
  memoryOptimizationMode?: StoryMemoryOptimizationMode
  storyRepetitionPenalty?: number
  storyTopK: number
  storyTopR: number
  storyTemperature?: number
  showGgThoughts: boolean
  showNpcThoughts: boolean
  ambientEnabled: boolean
  characterStateEnabled?: boolean
  emotionVisualizationEnabled?: boolean
  canonicalStatePipelineEnabled?: boolean
  canonicalStateSafeFallbackEnabled?: boolean
}

type CharacterRaceOption = {
  label: string
  value: string
  isCreateAction?: boolean
}



type RightPanelMode = 'ai' | 'world' | 'memory'
type AiPanelTab = 'instructions' | 'settings'
type WorldPanelTab = 'story' | 'world'
type CardsPanelTab = 'characters' | 'world' | 'instructions' | 'plot'
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
type AssistantMessageDisplayBlock = AssistantMessageBlock & {
  sourceIndex: number
}
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
type SceneEmotionCharacterEntry = {
  names: string[]
  displayName: string
  emotionAssets: StoryCharacterEmotionAssets
  isMainHero: boolean
}
type VisualStageParticipant = StorySceneEmotionCueParticipant & {
  assetUrl: string
  displayName: string
  isMainHero: boolean
}

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const PENDING_PAYMENT_STORAGE_KEY = 'morius.pending.payment.id'
const STREAMING_CARET_CLASS_NAME = 'morius-streaming-caret'
const STORY_TURN_IMAGE_REQUEST_TIMEOUT_DEFAULT_MS = 120_000
const STORY_TURN_IMAGE_REQUEST_TIMEOUT_GROK_MS = 120_000
const STORY_IMAGE_STYLE_PROMPT_MAX_LENGTH = 320
const STORY_PROMPT_MAX_LENGTH = 4000
const STORY_BUG_REPORT_TITLE_MAX_LENGTH = 160
const STORY_BUG_REPORT_DESCRIPTION_MAX_LENGTH = 8000
const FINAL_PAYMENT_STATUSES = new Set(['succeeded', 'canceled'])
const CHARACTER_AVATAR_MAX_BYTES = 2 * 1024 * 1024
const CARDS_PANEL_TABS_DRAG_THRESHOLD_PX = 10
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
const STORY_CHARACTER_RACE_MAX_LENGTH = 120
const STORY_CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH = 1000
const DEFAULT_CHARACTER_RACE_VALUES = [
  '\u0427\u0435\u043b\u043e\u0432\u0435\u043a',
  '\u042d\u043b\u044c\u0444',
  '\u0414\u0432\u0430\u0440\u0444',
  '\u041f\u043e\u043b\u0443\u0440\u043e\u0441\u043b\u0438\u043a',
  '\u0413\u043d\u043e\u043c',
  '\u0414\u0440\u0443\u0433\u043e\u0435',
] as const
const WORLD_CARD_CONTENT_MAX_LENGTH = 8000
const STORY_PLOT_CARD_CONTENT_MAX_LENGTH = 32000
const STORY_CHARACTER_DESCRIPTION_MAX_LENGTH = 6000
const filterCharacterRaceOptions = createFilterOptions<CharacterRaceOption>()
const filterWorldDetailTypeOptions = createFilterOptions<WorldDetailTypeAutocompleteOption>()
const STORY_MESSAGE_MAX_LENGTH = 20000
const STORY_CONTEXT_LIMIT_MIN = 6000
const STORY_CONTEXT_LIMIT_MAX = 32000
const STORY_DEFAULT_CONTEXT_LIMIT = 6000
const STORY_KEY_MEMORY_BUDGET_SHARE = 0.1
const STORY_KEY_MEMORY_MIN_BUDGET_TOKENS = 500
const STORY_PLOT_CONTEXT_MAX_SHARE = 0.35
const STORY_RESPONSE_MAX_TOKENS_MIN = 200
const STORY_RESPONSE_MAX_TOKENS_MAX = 800
const STORY_DEFAULT_RESPONSE_MAX_TOKENS = 400
const STORY_TURN_COST_TIER_1_CONTEXT_LIMIT_MAX = 6000
const STORY_TURN_COST_TIER_2_CONTEXT_LIMIT_MAX = 16000
const STORY_TURN_COST_STANDARD_TIERS: readonly [number, number, number] = [1, 2, 4]
const STORY_TURN_COST_PREMIUM_TIERS: readonly [number, number, number] = [2, 4, 8]
const STORY_TURN_COST_GLM51_TIERS: readonly [number, number, number] = [3, 6, 12]
const STORY_TURN_COST_STANDARD_NARRATOR_MODELS = new Set<StoryNarratorModelId>([
  'deepseek/deepseek-chat-v3-0324',
  'deepseek/deepseek-v3.2',
  'z-ai/glm-4.7',
  'x-ai/grok-4.1-fast',
  'xiaomi/mimo-v2-flash',
  'mistralai/mistral-nemo',
])
const STORY_TURN_COST_PREMIUM_NARRATOR_MODELS = new Set<StoryNarratorModelId>([
  'z-ai/glm-5',
  'aion-labs/aion-2.0',
  'xiaomi/mimo-v2-pro',
])
const STORY_TOP_K_MIN = 0
const STORY_TOP_K_MAX = 200
const STORY_DEFAULT_TOP_K = 55
const STORY_REPETITION_PENALTY_MIN = 1
const STORY_REPETITION_PENALTY_MAX = 2
const STORY_DEFAULT_REPETITION_PENALTY = 1.05
const STORY_TOP_R_MIN = 0.1
const STORY_TOP_R_MAX = 1
const STORY_DEFAULT_TOP_R = 0.85
const STORY_TEMPERATURE_MIN = 0
const STORY_TEMPERATURE_MAX = 2
const STORY_DEFAULT_TEMPERATURE = 0.85
const STORY_DEFAULT_NARRATOR_MODEL_ID: StoryNarratorModelId = 'deepseek/deepseek-chat-v3-0324'
const STORY_IMAGE_MODEL_FLUX_ID: StoryImageModelId = 'black-forest-labs/flux.2-pro'
const STORY_IMAGE_MODEL_SEEDREAM_ID: StoryImageModelId = 'bytedance-seed/seedream-4.5'
const STORY_IMAGE_MODEL_NANO_BANANO_ID: StoryImageModelId = 'google/gemini-2.5-flash-image'
const STORY_IMAGE_MODEL_NANO_BANANO_2_ID: StoryImageModelId = 'google/gemini-3.1-flash-image-preview'
const STORY_IMAGE_MODEL_GROK_ID: StoryImageModelId = 'grok-imagine-image'
const STORY_IMAGE_MODEL_GROK_LEGACY_ID: StoryImageModelId = 'grok-imagine-image-pro'
const STORY_DEFAULT_IMAGE_MODEL_ID: StoryImageModelId = STORY_IMAGE_MODEL_FLUX_ID
const STORY_AUTOSCROLL_BOTTOM_THRESHOLD = 72
const STORY_VISIBLE_ASSISTANT_TURNS_INITIAL = 20
const STORY_VISIBLE_ASSISTANT_TURNS_PAGE = 20
const STORY_LOAD_OLDER_SCROLL_TOP_THRESHOLD = 160
const STORY_TRIM_TO_RECENT_SCROLL_BOTTOM_THRESHOLD = 220
const COMPOSER_TOP_ACTION_BUTTON_SIZE = 46
const COMPOSER_SEND_BUTTON_SIZE = 36
const COMPOSER_INPUT_MIN_HEIGHT = 44
const COMPOSER_INPUT_MAX_HEIGHT = 184
const STORY_CONTINUE_PROMPT = 'Продолжай'
const STORY_CHARACTER_EMOTION_IDS: StoryCharacterEmotionId[] = [
  'calm',
  'angry',
  'irritated',
  'stern',
  'cheerful',
  'smiling',
  'sly',
  'alert',
  'scared',
  'happy',
  'embarrassed',
  'confused',
  'thoughtful',
]
const STORY_CHARACTER_EMOTION_LABELS: Record<StoryCharacterEmotionId, string> = {
  calm: 'Спокойствие',
  angry: 'Злость',
  irritated: 'Раздражение',
  stern: 'Строгость',
  cheerful: 'Веселье',
  smiling: 'Улыбка',
  sly: 'Хитрость',
  alert: 'Настороженность',
  scared: 'Страх',
  happy: 'Счастье',
  embarrassed: 'Смущение',
  confused: 'Растерянность',
  thoughtful: 'Задумчивость',
}
/* const STORY_STAGE_MAIN_HERO_LOOKUP_ALIASES = [
  'главный герой',
  'герой',
  'ты',
  'тебя',
  'тебе',
  'тобой',
  'вас',
  'я',
  'нас',
  'you',
  'yours',
  'player',
  'protagonist',
  'hero',
  'mc',
] as const
const EMOTION_STAGE_DEFAULT_HEIGHT_RATIO = 0.54
const EMOTION_STAGE_MAX_HEIGHT_RATIO = 0.72
type StoryNarratorStat = {
  label: string
  value: number
}
type StoryNarratorSamplingDefaults = {
  storyTemperature: number
  storyRepetitionPenalty: number
  storyTopK: number
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

*/

const STORY_STAGE_MAIN_HERO_LOOKUP_ALIASES = [
  'гг',
  'главный герой',
  'герой',
  'ты',
  'тебя',
  'тебе',
  'тобой',
  'вы',
  'вас',
  'вам',
  'вами',
  'я',
  'меня',
  'мне',
  'мной',
  'мы',
  'нас',
  'нам',
  'нами',
  'you',
  'your',
  'yours',
  'player',
  'protagonist',
  'hero',
  'mc',
] as const
const MAIN_HERO_SPEAKER_ALIASES = STORY_STAGE_MAIN_HERO_LOOKUP_ALIASES
const EMOTION_STAGE_MIN_HEIGHT_PX = 260
const EMOTION_STAGE_DEFAULT_HEIGHT_RATIO = 0.54
const EMOTION_STAGE_MAX_HEIGHT_RATIO = 0.72
type StoryNarratorStat = {
  label: string
  value: number
}

type StoryNarratorSamplingDefaults = {
  storyTemperature: number
  storyRepetitionPenalty: number
  storyTopK: number
  storyTopR: number
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
const NARRATOR_STAT_FALLBACK_LABELS = ['Интеллект', 'Скорость', 'Глубина'] as const

const STORY_NARRATOR_SAMPLING_DEFAULTS: Record<StoryNarratorModelId, StoryNarratorSamplingDefaults> = {
  'z-ai/glm-5': {
    storyTemperature: 0.9,
    storyRepetitionPenalty: 1.15,
    storyTopK: 60,
    storyTopR: 0.88,
  },
  'z-ai/glm-5.1': {
    storyTemperature: 0.92,
    storyRepetitionPenalty: 1.2,
    storyTopK: 65,
    storyTopR: 0.88,
  },
  'z-ai/glm-4.7': {
    storyTemperature: 0.85,
    storyRepetitionPenalty: 1.05,
    storyTopK: 55,
    storyTopR: 0.85,
  },
  'deepseek/deepseek-chat-v3-0324': {
    storyTemperature: 0.78,
    storyRepetitionPenalty: 1.08,
    storyTopK: 50,
    storyTopR: 0.85,
  },
  'deepseek/deepseek-v3.2': {
    storyTemperature: 0.82,
    storyRepetitionPenalty: 1.08,
    storyTopK: 50,
    storyTopR: 0.85,
  },
  'x-ai/grok-4.1-fast': {
    storyTemperature: 0.85,
    storyRepetitionPenalty: 1.05,
    storyTopK: 50,
    storyTopR: 0.85,
  },
  'mistralai/mistral-nemo': {
    storyTemperature: 0.85,
    storyRepetitionPenalty: 1.05,
    storyTopK: 55,
    storyTopR: 0.85,
  },
  'xiaomi/mimo-v2-flash': {
    storyTemperature: 0.85,
    storyRepetitionPenalty: 1.1,
    storyTopK: 50,
    storyTopR: 0.85,
  },
  'xiaomi/mimo-v2-pro': {
    storyTemperature: 0.88,
    storyRepetitionPenalty: 1.15,
    storyTopK: 55,
    storyTopR: 0.87,
  },
  'aion-labs/aion-2.0': {
    storyTemperature: 0.88,
    storyRepetitionPenalty: 1.1,
    storyTopK: 55,
    storyTopR: 0.87,
  },
}

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
    id: 'z-ai/glm-5.1',
    title: 'GLM 5.1',
    description:
      'Усиленная версия GLM с более жёстким контролем сцены, аккуратным стилем и немного более дорогим ходом.',
    portraitSrc: narratorOgmaPortrait,
    portraitAlt: 'GLM 5.1',
    stats: [
      { label: 'Интеллект', value: 5 },
      { label: 'Скорость', value: 4 },
      { label: 'Глубина', value: 4 },
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
    id: 'deepseek/deepseek-chat-v3-0324',
    title: 'DeepSeek V3',
    description:
      'Более яркая и динамичная версия DeepSeek. Дает много энергии и неожиданных ходов, но лучше всего раскрывается с четкими правилами и дисциплиной сцены.',
    portraitSrc: narratorVelesPortrait,
    portraitAlt: 'DeepSeek V3',
    stats: [
      { label: 'Интеллект', value: 4 },
      { label: 'Скорость', value: 5 },
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
    id: 'xiaomi/mimo-v2-flash',
    title: 'MiMo V2 Flash',
    description:
      'Легкая и быстрая модель Xiaomi для коротких сцен и динамичных проб. Лучше чувствует себя в простых играх с небольшим числом правил, чем в сложной дисциплине.',
    portraitSrc: narratorIsidaPortrait,
    portraitAlt: 'MiMo V2 Flash',
    stats: [
      { label: 'Интеллект', value: 2 },
      { label: 'Скорость', value: 5 },
      { label: 'Глубина', value: 3 },
    ],
  },
  {
    id: 'mistralai/mistral-nemo',
    title: 'Mistral Nemo',
    description:
      'Сбалансированная модель для ровного темпа, более чистого текста и надёжного контроля сцены.',
    portraitSrc: narratorOgmaPortrait,
    portraitAlt: 'Mistral Nemo',
    stats: [
      { label: 'Интеллект', value: 4 },
      { label: 'Скорость', value: 4 },
      { label: 'Глубина', value: 3 },
    ],
  },
  {
    id: 'xiaomi/mimo-v2-pro',
    title: 'Xiaomi Mimo Pro',
    description:
      'Более сильная версия Xiaomi с лучшей дисциплиной, большей детализацией и более уверенным ведением сцены, чем Flash.',
    portraitSrc: narratorIsidaPortrait,
    portraitAlt: 'Xiaomi Mimo Pro',
    stats: [
      { label: 'Интеллект', value: 4 },
      { label: 'Скорость', value: 4 },
      { label: 'Глубина', value: 4 },
    ],
  },
  {
    id: 'aion-labs/aion-2.0',
    title: 'AionLabs',
    description:
      'Лучше всего подходит для продуманных сцен, где особенно важны логика, связность и последовательность.',
    portraitSrc: narratorVelesPortrait,
    portraitAlt: 'AionLabs',
    stats: [
      { label: 'Интеллект', value: 5 },
      { label: 'Скорость', value: 3 },
      { label: 'Глубина', value: 4 },
    ],
  },
].filter(
  (option): option is StoryNarratorModelOption =>
    option.id !== 'z-ai/glm-4.7' && option.id !== 'mistralai/mistral-nemo',
)
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
    'Выберите модель рассказчика. DeepSeek V3.2 быстрее и агрессивнее двигает сюжет, GLM 5.0 стабильнее держит инструкции и язык, MiMo V2 Flash легче и быстрее для простых сцен, а Grok 4.1 Fast отвечает очень быстро, но может быть поверхностнее.',
  artist:
    'Выберите ИИ-модель для генерации изображения. У каждой модели своя цена и свой визуальный почерк.',
  contextLimit:
    'Ограничение памяти истории для ИИ. Чем выше лимит, тем дороже ход. Новый максимум — 32000, а стоимость зависит и от диапазона контекста, и от выбранного рассказчика.',
  responseTokens: 'Ограничьте объем ответа ИИ точнее в токенах.',
  showGgThoughts: 'Настройка того, будет ли ИИ генерировать и транслировать мысли вашего ГГ.',
  showNpcThoughts: 'Настройка того, будет ли ИИ генерировать и транслировать мысли NPC.',
  memoryOptimization:
    'Помогает дольше помнить старые события, ужимая память без потери смысла и важных деталей.',
  memoryOptimizationMode:
    'Вы можете изменить уровень оптимизации памяти, чтобы замедлить заполнение контекста. Важно: чем выше уровень, тем раньше могут начать пропадать детали.',
  ambient:
    'Бета. Подсветка вокруг поля ввода меняется по окружению сцены: фон, свет, погода и локация. Включение стоит +1 сол за ход, а ответ может генерироваться дольше.',
  advancedRegeneration:
    'Перед перегенерацией позволяет выбрать, что именно исправить: язык, длину, стиль, факты, повторения и т.д.',
  canonicalStatePipeline:
    'Админ-настройка. Включает RPG pipeline v1: канон состояния, план сцены, анти-повторы и проверку формата ответа перед сохранением хода.',
  canonicalStateSafeFallback:
    'Админ-настройка. При грубой поломке формата или языка заменяет ответ короткой безопасной сценой вместо сохранения проблемного текста.',
  temperature:
    'Только для опытных. Настройка того, насколько креативно и смело будет отвечать ИИ.',
  contextUsage: 'Следите за тем, сколько у вас осталось места в памяти истории для ИИ.',
} as const

const ADVANCED_REGENERATION_STORAGE_PREFIX = 'morius-advanced-regeneration'
const DEFAULT_SMART_REGENERATION_OPTIONS: SmartRegenerationOption[] = ['preserve_format']

function buildAdvancedRegenerationStorageKey(userId: number, gameId: number): string {
  return `${ADVANCED_REGENERATION_STORAGE_PREFIX}:${userId}:${gameId}`
}

const NARRATOR_STAT_MOJIBAKE_MARKER_REGEX = /[\u0420\u040E\u0402]/u

function formatStoryImageModelLabel(option: { title: string; priceLabel: string }): string {
  return `${option.title} (${option.priceLabel})`
}

function resolveNarratorStatLabel(label: string, index: number): string {
  const normalizedLabel = label.trim()
  if (!normalizedLabel) {
    return NARRATOR_STAT_FALLBACK_LABELS[index] ?? 'Параметр'
  }
  if (NARRATOR_STAT_MOJIBAKE_MARKER_REGEX.test(normalizedLabel)) {
    return NARRATOR_STAT_FALLBACK_LABELS[index] ?? normalizedLabel
  }
  return normalizedLabel
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

function ComposerContinueIcon() {
  return (
    <SvgIcon viewBox="0 0 19 20" sx={{ width: 18, height: 18 }}>
      <path
        d="M17.4676 8.12172C17.8037 8.30678 18.084 8.57866 18.2792 8.90899C18.4744 9.23932 18.5774 9.61598 18.5774 9.99968C18.5774 10.3834 18.4744 10.76 18.2792 11.0904C18.084 11.4207 17.8037 11.6926 17.4676 11.8776L3.17566 19.7353C2.8492 19.9146 2.48167 20.0057 2.10927 19.9997C1.73688 19.9937 1.37247 19.8908 1.05195 19.7011C0.731428 19.5114 0.465856 19.2415 0.281396 18.918C0.0969356 18.5944 -4.80416e-05 18.2284 1.78529e-08 17.8559V2.14342C6.37975e-05 1.77089 0.0972007 1.40481 0.281837 1.08126C0.466473 0.757707 0.732235 0.487852 1.05293 0.298293C1.37362 0.108733 1.73817 0.00601298 2.11066 0.000256061C2.48314 -0.00550086 2.85069 0.0859043 3.17709 0.265462L17.4676 8.12172Z"
        fill="currentColor"
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

function AssetMaskIcon({
  src,
  size = 18,
  sx,
}: {
  src: string
  size?: number
  sx?: Record<string, unknown>
}) {
  const maskUrl = `url("${src}")`
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        display: 'block',
        flexShrink: 0,
        backgroundColor: 'currentColor',
        WebkitMaskImage: maskUrl,
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskImage: maskUrl,
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        maskSize: 'contain',
        ...(sx ?? {}),
      }}
    />
  )
}

function ViewToggleButton({
  cardsViewMode,
  setCardsViewMode,
}: {
  cardsViewMode: 'full' | 'compact'
  setCardsViewMode: (mode: 'full' | 'compact') => void
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={() => {
        const next = cardsViewMode === 'full' ? 'compact' : 'full'
        setCardsViewMode(next)
        try { localStorage.setItem('morius-cards-view-mode', next) } catch { /* ignore */ }
      }}
      title={cardsViewMode === 'full' ? 'Компактный вид' : 'Полный вид'}
      aria-label={cardsViewMode === 'full' ? 'Переключить в компактный вид' : 'Переключить в полный вид'}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.55,
        px: 1.1,
        py: 0.5,
        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 80%, transparent)',
        borderRadius: '8px',
        backgroundColor: 'transparent',
        color: 'var(--morius-text-secondary)',
        fontSize: '0.76rem',
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'color 140ms ease, border-color 140ms ease, background-color 140ms ease',
        '&:hover': {
          color: 'var(--morius-text-primary)',
          borderColor: 'var(--morius-card-border)',
          backgroundColor: 'rgba(255,255,255,0.05)',
        },
      }}
    >
      {cardsViewMode === 'full' ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="0" y="1" width="5" height="12" rx="1.5" fill="currentColor" opacity="0.7"/>
          <line x1="7" y1="3" x2="14" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="7" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="7" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="0" y="0" width="6" height="14" rx="1.5" fill="currentColor" opacity="0.7"/>
          <rect x="8" y="0" width="6" height="14" rx="1.5" fill="currentColor" opacity="0.5"/>
        </svg>
      )}
      {cardsViewMode === 'full' ? 'Компакт' : 'Полный'}
    </Box>
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
          <Box component="img" src={iconSrc} alt="" sx={{ width: 17, height: 17, opacity: 0.92, filter: 'brightness(0) invert(1)' }} />
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
  if (
    modelId === STORY_IMAGE_MODEL_GROK_ID ||
    modelId === STORY_IMAGE_MODEL_GROK_LEGACY_ID ||
    modelId === STORY_IMAGE_MODEL_NANO_BANANO_2_ID
  ) {
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

const MOBILE_COMPOSER_MEDIA_QUERY = '(max-width: 899px)'

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
const STORY_STAGE_MAX_WIDTH = 1180
const RIGHT_PANEL_CARD_HEIGHT = 198
const ASSISTANT_DIALOGUE_AVATAR_SIZE = 30
const ASSISTANT_DIALOGUE_AVATAR_GAP = 0.9
const STRUCTURED_MARKER_START_PATTERN = /^\[\[\s*([^\]:]+?)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*([\s\S]*)$/iu
const STRUCTURED_MARKER_LINE_START_PATTERN = /^\[\[\s*[^\]:]+?(?:\s*:\s*[^\]]+?)?\s*\]\]/u
const STRUCTURED_MARKER_INLINE_SPLIT_PATTERN = /\[\[\s*[^\]:]+?(?:\s*:\s*[^\]]+?)?\s*\]\]/giu
const STRUCTURED_MARKER_STANDALONE_PATTERN = /^\[\[\s*([^\]:]+?)(?:\s*:\s*([^\]]+?))?\s*\]\]\s*$/iu
const STRUCTURED_MARKER_ANY_PATTERN = /\[\[\s*[^\]]+?\s*\]\]/gu
const STRUCTURED_MARKER_DANGLING_PATTERN = /\[\[[^\]]*$/u
const STRUCTURED_TAG_PATTERN = /^<\s*([A-Za-z\u0400-\u04FF_ -]+)(?:\s*:\s*([^>]+?))?\s*>([\s\S]*?)<\/\s*([A-Za-z\u0400-\u04FF_ -]+)\s*>$/iu
const PLAIN_SPEAKER_LINE_PATTERN = /^\s*([A-Z\u0410-\u042f\u0401][^:\n]{0,80}?)(?:\s*\(((?:\u0432 \u0433\u043e\u043b\u043e\u0432\u0435|\u043c\u044b\u0441\u043b\u0435\u043d\u043d\u043e|\u043c\u044b\u0441\u043b\u0438))\))?\s*:\s*([\s\S]+?)\s*$/iu
const ASSISTANT_SPEAKER_NAME_MAX_WORDS = 4
const ASSISTANT_SPEAKER_NAME_DISALLOWED_PUNCTUATION_PATTERN = /[,;.!?]/u
const ASSISTANT_SPEAKER_NAME_TOKEN_PATTERN = /^[0-9A-Za-z\u0410-\u042f\u0430-\u044f\u0401\u0451'\u2019-]+$/u
const ASSISTANT_SPEAKER_NAME_VERB_PATTERN =
  /(?:\u0435\u0448\u044c|\u0438\u0448\u044c|\u0435\u0442\u0435|\u0438\u0442\u0435|\u0435\u0442\u0441\u044f|\u0451\u0442\u0441\u044f|\u0438\u0442\u0441\u044f|\u044e\u0442\u0441\u044f|\u0430\u0442\u0441\u044f|\u044f\u0442\u0441\u044f|\u0430\u043b\u0441\u044f|\u0430\u043b\u0430\u0441\u044c|\u0430\u043b\u043e\u0441\u044c|\u0430\u043b\u0438\u0441\u044c|\u0438\u043b\u0441\u044f|\u0438\u043b\u0430\u0441\u044c|\u0438\u043b\u043e\u0441\u044c|\u0438\u043b\u0438\u0441\u044c|\u0430\u043b|\u0430\u043b\u0430|\u0430\u043b\u043e|\u0430\u043b\u0438|\u0438\u043b|\u0438\u043b\u0430|\u0438\u043b\u043e|\u0438\u043b\u0438|\u0443\u0442|\u044e\u0442|\u0430\u0442|\u044f\u0442|\u0435\u0442|\u0451\u0442|\u0438\u0442)$/iu
const GENERIC_DIALOGUE_SPEAKER_DEFAULT = 'НПС'
const MAIN_HERO_INLINE_TAG_PATTERN = /\[\[\s*GG(?:\s*:\s*([^\]]+?))?\s*\]\]/giu
const MAIN_HERO_FALLBACK_NAME = 'Главный Герой'
const SPEAKER_REFERENCE_PREFIX_PATTERN = /^(?:char|character|\u043f\u0435\u0440\u0441\u043e\u043d\u0430\u0436)\s*:\s*/iu
const STORY_TOKEN_ESTIMATE_PATTERN = /[0-9a-z\u0430-\u044f\u0451]+|[^\s]/gi
const STORY_SENTENCE_MATCH_PATTERN = /[^.!?\u2026]+[.!?\u2026]?/gu
const STORY_BULLET_PREFIX_PATTERN = /^\s*[-\u2022*]+\s*/u
const STORY_MATCH_TOKEN_PATTERN = /[0-9a-z\u0430-\u044f\u0451]+/gi
const STORY_CYRILLIC_TOKEN_PATTERN = /^[\u0430-\u044f\u0451]+$/i
const DIALOGUE_QUOTE_CUE_PATTERN = /["'\u00ab\u00bb\u201e\u201c\u201d]/u
const DIALOGUE_DASH_START_CUE_PATTERN = /^\s*(?:\u2014|-)\s*\S/u
const DIALOGUE_DASH_AFTER_PUNCT_CUE_PATTERN = /[.!?\u2026]\s*(?:\u2014|-)\s*\S/u
const LOOSE_DIALOGUE_DASH_LINE_PATTERN = /^\s*(?:\u2014|-)\s+([\s\S]+?)\s*$/u
const LOOSE_DIALOGUE_QUOTE_LINE_PATTERN = /^\s*["\u00ab\u201e\u201c]([\s\S]+?)["\u00bb\u201d]*\s*$/u
const LOOSE_THOUGHT_LINE_PATTERN =
  /^\s*(?:\(|\[)?(?:мысл(?:ь|и)|в голове|мысленно|про себя|дум(?:аю|ает|ал(?:а|о|и)?)|thinking|thoughts?)\)?\s*[:\-]\s*([\s\S]+?)\s*$/iu
const LOOSE_ASSISTANT_CUE_BREAK_PATTERN =
  /([.!?\u2026])\s+(?=(?:["\u00ab\u201e\u201c]|(?:\u2014|-)\s*\S|(?:\(?\s*(?:мысл(?:ь|и)|в голове|мысленно|про себя|дум(?:аю|ает|ал(?:а|о|и)?)|thinking|thoughts?)\s*[:\-])))/giu
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
  raw: 'Свежие блоки · 50%',
  compressed: 'Сжатые блоки · 30%',
  super: 'Суперсжатые блоки · 20%',
}
const STORY_MEMORY_OPTIMIZATION_MODE_OPTIONS: Array<{
  value: StoryMemoryOptimizationMode
  label: string
}> = [
  { value: 'standard', label: 'Стандартный' },
  { value: 'enhanced', label: 'Усиленный' },
  { value: 'maximum', label: 'Максимальный' },
]
const STORY_MEMORY_LAYER_TITLE: Record<'raw' | 'compressed' | 'super', string> = {
  raw: 'Свежие блоки',
  compressed: 'Сжатые блоки',
  super: 'Суперсжатые блоки',
}
const STORY_MEMORY_LAYER_SHARE_BY_MODE: Record<
  StoryMemoryOptimizationMode,
  Record<'raw' | 'compressed' | 'super', number>
> = {
  standard: { raw: 50, compressed: 30, super: 20 },
  enhanced: { raw: 30, compressed: 50, super: 20 },
  maximum: { raw: 30, compressed: 40, super: 30 },
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

function toStoryText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toStoryStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => toStoryText(item).trim())
    .filter((item) => item.length > 0)
}

function normalizeStoryMessageItem(message: StoryMessage): StoryMessage {
  return {
    ...message,
    content: toStoryText(message.content),
    scene_emotion_payload:
      typeof message.scene_emotion_payload === 'string'
        ? message.scene_emotion_payload
        : message.scene_emotion_payload === null
          ? null
          : null,
  }
}

function normalizeStoryInstructionCardItem(card: StoryInstructionCard): StoryInstructionCard {
  return {
    ...card,
    title: toStoryText(card.title),
    content: toStoryText(card.content),
    is_active: Boolean(card.is_active),
  }
}

function normalizeStoryPlotCardItem(card: StoryPlotCard): StoryPlotCard {
  return {
    ...card,
    title: toStoryText(card.title),
    content: toStoryText(card.content),
    triggers: toStoryStringList(card.triggers),
    memory_turns: typeof card.memory_turns === 'number' && Number.isFinite(card.memory_turns) ? card.memory_turns : null,
  }
}

function normalizeStoryMemoryBlockItem(block: StoryMemoryBlock): StoryMemoryBlock {
  return {
    ...block,
    title: toStoryText(block.title),
    content: toStoryText(block.content),
    token_count: typeof block.token_count === 'number' && Number.isFinite(block.token_count) ? block.token_count : 0,
  }
}

function normalizeStoryWorldCardItem(card: StoryWorldCard): StoryWorldCard {
  return {
    ...card,
    title: toStoryText(card.title),
    content: toStoryText(card.content),
    triggers: toStoryStringList(card.triggers),
    memory_turns: typeof card.memory_turns === 'number' && Number.isFinite(card.memory_turns) ? card.memory_turns : null,
  }
}

function normalizeStoryMessages(items: StoryMessage[] | null | undefined): StoryMessage[] {
  return Array.isArray(items) ? items.map((item) => normalizeStoryMessageItem(item)) : []
}

function mergeStoryMessagesById(existingMessages: StoryMessage[], incomingMessages: StoryMessage[]): StoryMessage[] {
  const nextMap = new Map<number, StoryMessage>()
  existingMessages.forEach((message) => {
    nextMap.set(message.id, message)
  })
  incomingMessages.forEach((message) => {
    nextMap.set(message.id, message)
  })
  return [...nextMap.values()].sort((left, right) => left.id - right.id)
}

function normalizeStoryInstructionCards(items: StoryInstructionCard[] | null | undefined): StoryInstructionCard[] {
  return Array.isArray(items) ? items.map((item) => normalizeStoryInstructionCardItem(item)) : []
}

function normalizeStoryPlotCards(items: StoryPlotCard[] | null | undefined): StoryPlotCard[] {
  return Array.isArray(items) ? items.map((item) => normalizeStoryPlotCardItem(item)) : []
}

function normalizeStoryMemoryBlocks(items: StoryMemoryBlock[] | null | undefined): StoryMemoryBlock[] {
  return Array.isArray(items) ? items.map((item) => normalizeStoryMemoryBlockItem(item)) : []
}

function buildOptimisticRawTurnMemoryContent(
  userText: string,
  assistantText: string,
  mainHeroName: string,
): string {
  const normalizedUserText = toStoryText(userText).replace(/\r\n/g, '\n').trim()
  const normalizedAssistantText = toStoryText(assistantText).replace(/\r\n/g, '\n').trim()
  const normalizedMainHeroName = mainHeroName.replace(/\s+/g, ' ').trim() || 'игрок'
  const parts: string[] = []
  if (normalizedUserText) {
    parts.push(`Ход игрока: ${normalizedMainHeroName} (полный текст):\n${normalizedUserText}`)
  }
  if (normalizedAssistantText) {
    parts.push(`Ответ рассказчика (полный текст):\n${normalizedAssistantText}`)
  }
  return parts.join('\n\n').trim()
}

function buildOptimisticRawTurnMemoryTitle(content: string): string {
  const firstContentLine =
    content
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .find((line) => line.length > 0) ?? ''
  return firstContentLine.slice(0, 120).trim() || 'Свежий ход'
}

function normalizeStoryWorldCards(items: StoryWorldCard[] | null | undefined): StoryWorldCard[] {
  return Array.isArray(items) ? items.map((item) => normalizeStoryWorldCardItem(item)) : []
}

function resolveMessagesWindowStartIndex(messages: StoryMessage[], assistantTurnsToShow: number): number {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 0
  }
  const normalizedTurns = Math.max(1, Math.trunc(assistantTurnsToShow || 0))
  let assistantsSeen = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') {
      continue
    }
    assistantsSeen += 1
    if (assistantsSeen >= normalizedTurns) {
      let startIndex = index
      while (startIndex > 0 && messages[startIndex - 1]?.role === 'user') {
        startIndex -= 1
      }
      return Math.max(startIndex, 0)
    }
  }

  return 0
}

function splitAssistantParagraphs(content: string | null | undefined): string[] {
  const paragraphs = toStoryText(content)
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean)
  return paragraphs.length > 0 ? paragraphs : ['']
}

function stripStructuredMarkerArtifacts(value: string | null | undefined): string {
  let normalized = toStoryText(value).replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return ''
  }
  if (!normalized.includes('[[') && !normalized.includes(']]')) {
    return normalized
  }
  normalized = normalized.replace(STRUCTURED_MARKER_ANY_PATTERN, ' ')
  normalized = normalized.replace(STRUCTURED_MARKER_DANGLING_PATTERN, ' ')
  normalized = normalized.replace(/\[\[|\]\]/g, ' ')
  normalized = normalized.replace(/[ \t]+\n/g, '\n')
  normalized = normalized.replace(/\n{3,}/g, '\n\n')
  normalized = normalized
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
  return normalized.trim()
}

function splitAssistantParagraphByInlineMarkers(paragraph: string | null | undefined): string[] {
  const normalized = toStoryText(paragraph).replace(/\r\n/g, '\n').trim()
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

function isLikelyNarrativeFollowupSentence(sentence: string): boolean {
  const normalizedSentence = sentence.replace(/\s+/g, ' ').trim()
  if (!normalizedSentence) {
    return false
  }
  if (/^["'\u00ab\u00bb\u201e\u201c\u201d]/u.test(normalizedSentence)) {
    return false
  }
  if (/^(?:\u2014|-)\s*\S/u.test(normalizedSentence)) {
    return false
  }
  if (FIRST_OR_SECOND_PERSON_PRONOUN_PATTERN.test(normalizedSentence)) {
    return false
  }
  if (/^[A-Z\u0410-\u042f\u0401][A-Za-z\u0410-\u042f\u0430-\u044f\u0401\u0451-]*(?:\s+[A-Z\u0410-\u042f\u0401][A-Za-z\u0410-\u042f\u0430-\u044f\u0401\u0451-]*)?\s*,/u.test(normalizedSentence)) {
    return false
  }
  return /^[A-Z\u0410-\u042f\u0401][A-Za-z\u0410-\u042f\u0430-\u044f\u0401\u0451-]*(?:\s+[A-Z\u0410-\u042f\u0401][A-Za-z\u0410-\u042f\u0430-\u044f\u0401\u0451-]*)?\s+[a-z\u0430-\u044f\u0451-]+/u.test(
    normalizedSentence,
  )
}

function splitAssistantParagraphByInlinePlainSpeakerLines(paragraph: string | null | undefined): string[] {
  const normalized = toStoryText(paragraph).replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return []
  }
  if (normalized.includes('[[')) {
    return [normalized]
  }

  const sentences = splitStoryTextIntoSentences(normalized)
  if (sentences.length <= 1) {
    return [normalized]
  }

  const chunks: string[] = []
  const pendingNarrative: string[] = []
  const pendingDialogue: string[] = []
  let sawDialogue = false

  const flushNarrative = () => {
    if (pendingNarrative.length > 0) {
      chunks.push(pendingNarrative.join(' ').trim())
      pendingNarrative.length = 0
    }
  }

  const flushDialogue = () => {
    if (pendingDialogue.length > 0) {
      chunks.push(pendingDialogue.join(' ').trim())
      pendingDialogue.length = 0
    }
  }

  sentences.forEach((sentence) => {
    const plainSpeakerBlock = parsePlainSpeakerAssistantParagraph(sentence)
    if (plainSpeakerBlock && plainSpeakerBlock.type === 'character') {
      flushNarrative()
      flushDialogue()
      pendingDialogue.push(sentence)
      sawDialogue = true
      return
    }

    if (pendingDialogue.length > 0) {
      if (isLikelyNarrativeFollowupSentence(sentence)) {
        flushDialogue()
        pendingNarrative.push(sentence)
      } else {
        pendingDialogue.push(sentence)
      }
      return
    }

    pendingNarrative.push(sentence)
  })

  flushDialogue()
  flushNarrative()

  const normalizedChunks = chunks.filter((chunk) => chunk.trim().length > 0)
  return sawDialogue && normalizedChunks.length > 0 ? normalizedChunks : [normalized]
}

function normalizeAssistantStructuredParagraphs(content: string | null | undefined): string {
  const baseParagraphs = splitAssistantParagraphs(mergeAssistantOrphanStructuredParagraphs(toStoryText(content)))
  const normalizedParagraphs: string[] = []
  baseParagraphs.forEach((paragraph) => {
    splitAssistantParagraphByInlineMarkers(paragraph).forEach((chunk) => {
      normalizedParagraphs.push(...splitAssistantParagraphByInlinePlainSpeakerLines(chunk))
    })
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
    'рассказчик': 'narrator',
    'нарратор': 'narrator',
    'повествование': 'narration',
    npc: 'npc',
    'нпс': 'npc',
    'нпк': 'npc',
    npcreplick: 'npc',
    npcreplica: 'npc',
    npcspeech: 'npc',
    npcdialogue: 'npc',
    gg: 'gg',
    'гг': 'gg',
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
    'нпсмысль': 'npc_thought',
    'нпсмысли': 'npc_thought',
    'нпкмысль': 'npc_thought',
    'нпкмысли': 'npc_thought',
    'ггмысль': 'gg_thought',
    'ггмысли': 'gg_thought',
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

function isLikelyAssistantSpeakerName(rawValue: string | null | undefined): boolean {
  const normalized = normalizeAssistantSpeakerName(rawValue)
  if (!normalized) {
    return false
  }

  if (ASSISTANT_SPEAKER_NAME_DISALLOWED_PUNCTUATION_PATTERN.test(normalized)) {
    return false
  }

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > ASSISTANT_SPEAKER_NAME_MAX_WORDS) {
    return false
  }

  if (words.some((word) => !ASSISTANT_SPEAKER_NAME_TOKEN_PATTERN.test(word))) {
    return false
  }

  return !words.slice(1).some((word) => {
    const firstCharacter = word.charAt(0)
    return firstCharacter === firstCharacter.toLowerCase() && ASSISTANT_SPEAKER_NAME_VERB_PATTERN.test(word.toLowerCase())
  })
}

function stripLeadingStructuredMarkerLines(value: string | null | undefined): string {
  let normalized = toStoryText(value).replace(/\r\n/g, '\n').trim()
  while (true) {
    const nextValue = normalized.replace(
      /^\[\[\s*[^\]:]+?(?:\s*:\s*[^\]]+?)?\s*\]\]\s*(?:\n+\s*|\s+)/u,
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
  if (!speakerName || !isLikelyAssistantSpeakerName(speakerName)) {
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

function parseStructuredAssistantParagraph(paragraph: string | null | undefined): AssistantMessageBlock | null {
  const normalized = toStoryText(paragraph).replace(/\r\n/g, '\n').trim()
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

  const bodyText = stripStructuredMarkerArtifacts(stripLeadingStructuredMarkerLines(markerMatch[3].trim()))
  if (!bodyText) {
    return null
  }

  if (markerKind === 'narrative') {
    return { type: 'narrative', text: bodyText }
  }

  if (!speakerName || (rawSpeakerName && !isLikelyAssistantSpeakerName(speakerName))) {
    return null
  }

  return {
    type: 'character',
    speakerName,
    text: bodyText,
    delivery: markerKind === 'thought' ? 'thought' : 'speech',
  }
}

function parsePlainSpeakerAssistantParagraph(paragraph: string | null | undefined): AssistantMessageBlock | null {
  const normalized = toStoryText(paragraph).replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return null
  }

  const speakerMatch = normalized.match(PLAIN_SPEAKER_LINE_PATTERN)
  if (!speakerMatch) {
    return null
  }

  const speakerName = normalizeAssistantSpeakerName(speakerMatch[1])
  if (!speakerName || !isLikelyAssistantSpeakerName(speakerName)) {
    return null
  }

  const bodyText = stripStructuredMarkerArtifacts(speakerMatch[3]?.trim() ?? '')
  if (!bodyText) {
    return null
  }

  const speakerMarkerKind = resolveAssistantMarkerKind(normalizeAssistantMarkerKey(speakerName))
  if (speakerMarkerKind === 'narrative') {
    return { type: 'narrative', text: bodyText }
  }

  if (isLikelyNarrativeSpeechLine(bodyText, speakerName)) {
    return null
  }

  return {
    type: 'character',
    speakerName,
    text: bodyText,
    delivery: speakerMatch[2] ? 'thought' : 'speech',
  }
}

function parseTaggedAssistantParagraph(paragraph: string | null | undefined): AssistantMessageBlock | null {
  const normalized = toStoryText(paragraph).replace(/\r\n/g, '\n').trim()
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

  const bodyText = stripStructuredMarkerArtifacts(stripLeadingStructuredMarkerLines(tagMatch[3].trim()))
  if (!bodyText) {
    return null
  }

  if (tagDescriptor.kind === 'narrative') {
    return { type: 'narrative', text: bodyText }
  }

  const rawSpeakerName = tagMatch[2]?.trim() ?? ''
  const explicitSpeakerName = normalizeAssistantSpeakerName(rawSpeakerName)
  if (explicitSpeakerName && !isLikelyAssistantSpeakerName(explicitSpeakerName)) {
    return null
  }
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

function parseTaggedAssistantContent(content: string | null | undefined): AssistantMessageBlock[] | null {
  const normalized = toStoryText(content).replace(/\r\n/g, '\n').trim()
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
      const structuredBlock = parseStructuredAssistantParagraph(fragment)
      if (structuredBlock) {
        blocks.push(structuredBlock)
        return
      }
      const plainSpeakerBlock = parsePlainSpeakerAssistantParagraph(fragment)
      if (plainSpeakerBlock) {
        blocks.push(plainSpeakerBlock)
        return
      }
      const text = stripStructuredMarkerArtifacts(fragment)
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

function splitLooseAssistantParagraphFragments(paragraph: string | null | undefined): string[] {
  const normalized = toStoryText(paragraph).replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return []
  }
  const fragments = normalized
    .replace(LOOSE_ASSISTANT_CUE_BREAK_PATTERN, '$1\n')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
  return fragments.length > 0 ? fragments : [normalized]
}

function stripLooseDialogueWrapper(value: string | null | undefined): string {
  return stripStructuredMarkerArtifacts(value)
    .replace(/^\s*(?:\u2014|-)\s*/u, '')
    .replace(/^\s*["\u00ab\u201e\u201c]+/u, '')
    .replace(/["\u00bb\u201d]+\s*$/u, '')
    .trim()
}

function resolveLooseThoughtSpeakerName(value: string): string {
  return FIRST_OR_SECOND_PERSON_PRONOUN_PATTERN.test(value)
    ? MAIN_HERO_FALLBACK_NAME
    : GENERIC_DIALOGUE_SPEAKER_DEFAULT
}

function parseLooseAssistantFragment(fragment: string | null | undefined): AssistantMessageBlock | null {
  const normalized = toStoryText(fragment).replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return null
  }

  const thoughtMatch = normalized.match(LOOSE_THOUGHT_LINE_PATTERN)
  if (thoughtMatch) {
    const bodyText = stripLooseDialogueWrapper(thoughtMatch[1])
    if (!bodyText) {
      return null
    }
    return {
      type: 'character',
      speakerName: resolveLooseThoughtSpeakerName(bodyText),
      text: bodyText,
      delivery: 'thought',
    }
  }

  const dashDialogueMatch = normalized.match(LOOSE_DIALOGUE_DASH_LINE_PATTERN)
  if (dashDialogueMatch) {
    const bodyText = stripLooseDialogueWrapper(dashDialogueMatch[1])
    if (!bodyText) {
      return null
    }
    return {
      type: 'character',
      speakerName: GENERIC_DIALOGUE_SPEAKER_DEFAULT,
      text: bodyText,
      delivery: 'speech',
    }
  }

  const quotedDialogueMatch = normalized.match(LOOSE_DIALOGUE_QUOTE_LINE_PATTERN)
  if (quotedDialogueMatch) {
    const bodyText = stripLooseDialogueWrapper(quotedDialogueMatch[1])
    if (!bodyText) {
      return null
    }
    return {
      type: 'character',
      speakerName: GENERIC_DIALOGUE_SPEAKER_DEFAULT,
      text: bodyText,
      delivery: 'speech',
    }
  }

  return null
}

function parseLooseAssistantParagraph(paragraph: string | null | undefined): AssistantMessageBlock[] | null {
  const fragments = splitLooseAssistantParagraphFragments(paragraph)
  if (fragments.length === 0) {
    return null
  }

  const blocks: AssistantMessageBlock[] = []
  let hasCharacterBlock = false
  const pushBlock = (block: AssistantMessageBlock) => {
    const previousBlock = blocks[blocks.length - 1]
    if (!previousBlock) {
      blocks.push(block)
      return
    }
    if (previousBlock.type === 'narrative' && block.type === 'narrative') {
      previousBlock.text = `${previousBlock.text}\n${block.text}`.trim()
      return
    }
    if (
      previousBlock.type === 'character' &&
      block.type === 'character' &&
      previousBlock.delivery === block.delivery &&
      previousBlock.speakerName === block.speakerName
    ) {
      previousBlock.text = `${previousBlock.text}\n${block.text}`.trim()
      return
    }
    blocks.push(block)
  }

  fragments.forEach((fragment) => {
    const taggedBlock = parseTaggedAssistantParagraph(fragment)
    if (taggedBlock) {
      hasCharacterBlock = hasCharacterBlock || taggedBlock.type === 'character'
      pushBlock(taggedBlock)
      return
    }

    const structuredBlock = parseStructuredAssistantParagraph(fragment)
    if (structuredBlock) {
      hasCharacterBlock = hasCharacterBlock || structuredBlock.type === 'character'
      pushBlock(structuredBlock)
      return
    }

    const plainSpeakerBlock = parsePlainSpeakerAssistantParagraph(fragment)
    if (plainSpeakerBlock) {
      hasCharacterBlock = true
      pushBlock(plainSpeakerBlock)
      return
    }

    const looseBlock = parseLooseAssistantFragment(fragment)
    if (looseBlock) {
      hasCharacterBlock = true
      pushBlock(looseBlock)
      return
    }

    const cleanedText = stripStructuredMarkerArtifacts(fragment)
    if (!cleanedText) {
      return
    }
    pushBlock({ type: 'narrative', text: cleanedText })
  })

  return hasCharacterBlock && blocks.length > 0 ? blocks : null
}

function parseAssistantMessageBlocks(content: string | null | undefined): AssistantMessageBlock[] {
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

    const plainSpeakerBlock = parsePlainSpeakerAssistantParagraph(paragraph)
    if (plainSpeakerBlock) {
      blocks.push(plainSpeakerBlock)
      return
    }

    const looseBlocks = parseLooseAssistantParagraph(paragraph)
    if (looseBlocks) {
      blocks.push(...looseBlocks)
      return
    }

    // Strict mode: any unmarked paragraph is treated as narration only.
    const cleanedParagraph = stripStructuredMarkerArtifacts(paragraph)
    if (cleanedParagraph) {
      blocks.push({ type: 'narrative', text: cleanedParagraph })
    }
  })
  return blocks
    .map((block) => {
      const cleanedText = stripStructuredMarkerArtifacts(block.text)
      if (!cleanedText) {
        return null
      }
      if (block.type === 'character') {
        const cleanedSpeakerName = stripStructuredMarkerArtifacts(block.speakerName).replace(/\s+/g, ' ').trim()
        if (!cleanedSpeakerName) {
          return { type: 'narrative', text: cleanedText } as AssistantMessageBlock
        }
        return {
          ...block,
          speakerName: cleanedSpeakerName,
          text: cleanedText,
        }
      }
      return {
        ...block,
        text: cleanedText,
      }
    })
    .filter((block): block is AssistantMessageBlock => block !== null)
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
  const normalizedText = stripStructuredMarkerArtifacts(toStoryText(block.text)).replace(/\r\n/g, '\n').trim()
  if (!normalizedText) {
    return ''
  }

  if (block.type === 'narrative') {
    return normalizedText
  }

  const speakerName = stripStructuredMarkerArtifacts(block.speakerName).replace(/\s+/g, ' ').trim() || GENERIC_DIALOGUE_SPEAKER_DEFAULT
  const markerName = block.delivery === 'thought' ? 'NPC_THOUGHT' : 'NPC'
  return `[[${markerName}:${speakerName}]] ${normalizedText}`
}

function serializeAssistantMessageBlocks(blocks: AssistantMessageBlock[]): string {
  return blocks
    .map((block) => serializeAssistantMessageBlock(block))
    .filter((value) => value.length > 0)
    .join('\n\n')
    .trim()
}

function buildAssistantMessageContentWithEditedBlock(
  content: string | null | undefined,
  sourceIndex: number,
  nextText: string,
): string | null {
  const blocks = parseAssistantMessageBlocks(content)
  if (blocks.length === 0 || sourceIndex < 0 || sourceIndex >= blocks.length) {
    return null
  }

  const normalizedText = nextText.replace(/\r\n/g, '\n').trim()
  const nextBlocks = normalizedText
    ? blocks.map((block, index) => (index === sourceIndex ? { ...block, text: normalizedText } : block))
    : blocks.filter((_, index) => index !== sourceIndex)
  const serialized = serializeAssistantMessageBlocks(nextBlocks)
  return serialized
}

function isMainHeroThoughtSpeakerName(rawSpeakerName: string, mainHeroName: string): boolean {
  const heroAliases = new Set<string>()
  ;[mainHeroName, MAIN_HERO_FALLBACK_NAME, ...MAIN_HERO_SPEAKER_ALIASES].forEach((value) => {
    buildCharacterAliases(value).forEach((alias) => heroAliases.add(alias))
  })
  if (heroAliases.size === 0) {
    return false
  }
  return extractSpeakerLookupValues(rawSpeakerName).some((value) => {
    const normalizedValue = normalizeCharacterIdentity(value)
    return normalizedValue.length > 0 && heroAliases.has(normalizedValue)
  })
}

function filterAssistantMessageBlocksForDisplay(
  blocks: AssistantMessageBlock[],
  options: {
    mainHeroName: string
    showNpcThoughts: boolean
  },
): AssistantMessageDisplayBlock[] {
  const { mainHeroName, showNpcThoughts } = options
  const displayBlocks: AssistantMessageDisplayBlock[] = []
  blocks.forEach((block, sourceIndex) => {
    if (block.type !== 'character' || block.delivery !== 'thought') {
      displayBlocks.push({ ...block, sourceIndex })
      return
    }
    if (isMainHeroThoughtSpeakerName(block.speakerName, mainHeroName)) {
      return
    }
    if (showNpcThoughts) {
      displayBlocks.push({ ...block, sourceIndex })
    }
  })
  return displayBlocks
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
  ['sh', 'ш'],
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

function normalizeCharacterRaceValue(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, STORY_CHARACTER_RACE_MAX_LENGTH)
}

function normalizeCharacterAdditionalValue(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, STORY_CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH)
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
  const normalizedSource = snapshot.source === 'ai' ? 'ai' : 'user'
  const normalizedMemoryTurns =
    typeof snapshot.memory_turns === 'number' && Number.isFinite(snapshot.memory_turns) ? snapshot.memory_turns : null
  return {
    id: cardId,
    game_id: gameId,
    title: toStoryText(snapshot.title),
    content: toStoryText(snapshot.content),
    triggers: toStoryStringList(snapshot.triggers),
    memory_turns: normalizedMemoryTurns,
    ai_edit_enabled: Boolean(snapshot.ai_edit_enabled),
    is_enabled: Boolean(snapshot.is_enabled),
    source: normalizedSource,
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
  const normalizedKind: StoryWorldCardKind =
    snapshot.kind === 'npc' || snapshot.kind === 'main_hero' || snapshot.kind === 'world' || snapshot.kind === 'world_profile'
      ? snapshot.kind
      : 'world'
  const normalizedAvatarScale =
    typeof snapshot.avatar_scale === 'number' && Number.isFinite(snapshot.avatar_scale) ? snapshot.avatar_scale : 1
  const normalizedCharacterId =
    typeof snapshot.character_id === 'number' && Number.isFinite(snapshot.character_id) ? snapshot.character_id : null
  const normalizedMemoryTurns =
    typeof snapshot.memory_turns === 'number' && Number.isFinite(snapshot.memory_turns) ? snapshot.memory_turns : null
  const normalizedSource = snapshot.source === 'ai' ? 'ai' : 'user'
  const normalizedAvatarUrl = toStoryText(snapshot.avatar_url)
  return {
    id: cardId,
    game_id: gameId,
    title: toStoryText(snapshot.title),
    content: toStoryText(snapshot.content),
    race: normalizeCharacterRaceValue(snapshot.race),
    clothing: normalizeCharacterAdditionalValue(snapshot.clothing),
    inventory: normalizeCharacterAdditionalValue(snapshot.inventory),
    health_status: normalizeCharacterAdditionalValue(snapshot.health_status),
    triggers: toStoryStringList(snapshot.triggers),
    kind: normalizedKind,
    detail_type: normalizeStoryWorldDetailTypeValue(snapshot.detail_type),
    avatar_url: normalizedAvatarUrl || null,
    avatar_scale: normalizedAvatarScale,
    character_id: normalizedCharacterId,
    memory_turns: normalizedMemoryTurns,
    is_locked: Boolean(snapshot.is_locked),
    ai_edit_enabled: Boolean(snapshot.ai_edit_enabled),
    source: normalizedSource,
    created_at: nowIso,
    updated_at: nowIso,
  }
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

function normalizeStoryMemoryOptimizationMode(value: string | null | undefined): StoryMemoryOptimizationMode {
  if (value === 'enhanced' || value === 'maximum' || value === 'standard') {
    return value
  }
  return 'standard'
}

function getStoryMemoryLayerLabel(
  layer: 'raw' | 'compressed' | 'super',
  mode: StoryMemoryOptimizationMode,
): string {
  const share = STORY_MEMORY_LAYER_SHARE_BY_MODE[mode]?.[layer] ?? STORY_MEMORY_LAYER_SHARE_BY_MODE.standard[layer]
  const title = STORY_MEMORY_LAYER_TITLE[layer]
  const legacyLabelExists = Boolean(AI_MEMORY_LAYER_LABEL[layer])
  return `${title} · ${legacyLabelExists ? share : share}%`
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

function normalizeStoryCharacterEmotionAssets(value: unknown): StoryCharacterEmotionAssets {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const normalizedAssets: StoryCharacterEmotionAssets = {}
  STORY_CHARACTER_EMOTION_IDS.forEach((emotionId) => {
    const rawAsset = (value as Record<string, unknown>)[emotionId]
    if (typeof rawAsset === 'string' && rawAsset.trim().length > 0) {
      normalizedAssets[emotionId] = rawAsset
    }
  })
  return normalizedAssets
}

function parseStorySceneEmotionPayload(rawValue: string | null | undefined): StorySceneEmotionCue | null {
  const normalizedValue = (rawValue ?? '').trim()
  if (!normalizedValue) {
    return null
  }

  let parsedValue: unknown
  try {
    parsedValue = JSON.parse(normalizedValue)
  } catch {
    return null
  }

  if (!parsedValue || typeof parsedValue !== 'object') {
    return null
  }

  const payload = parsedValue as Record<string, unknown>
  const rawParticipants = Array.isArray(payload.participants) ? payload.participants : []
  const participants: StorySceneEmotionCueParticipant[] = []

  rawParticipants.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return
    }
    const participant = item as Record<string, unknown>
    const name = typeof participant.name === 'string' ? participant.name.trim() : ''
    const emotion = typeof participant.emotion === 'string' ? (participant.emotion as StoryCharacterEmotionId) : null
    const importance = participant.importance === 'secondary' ? 'secondary' : 'primary'
    if (!name || !emotion || !STORY_CHARACTER_EMOTION_IDS.includes(emotion)) {
      return
    }
    participants.push({
      name,
      emotion,
      importance: index === 0 ? 'primary' : importance,
    })
  })

  const showVisualization = Boolean(payload.show_visualization) && participants.length > 0
  const reason = typeof payload.reason === 'string' && payload.reason.trim().length > 0 ? payload.reason.trim() : 'no_interaction'

  return {
    show_visualization: showVisualization,
    reason,
    participants: showVisualization ? participants.slice(0, 4) : [],
  }
}

function getStoryNarratorTurnCostTiers(modelId: StoryNarratorModelId): readonly [number, number, number] {
  if (modelId === 'z-ai/glm-5.1') {
    return STORY_TURN_COST_GLM51_TIERS
  }
  if (STORY_TURN_COST_PREMIUM_NARRATOR_MODELS.has(modelId)) {
    return STORY_TURN_COST_PREMIUM_TIERS
  }
  if (STORY_TURN_COST_STANDARD_NARRATOR_MODELS.has(modelId)) {
    return STORY_TURN_COST_STANDARD_TIERS
  }
  return STORY_TURN_COST_STANDARD_TIERS
}

function getStoryTurnCostTooltipText(): string {
  return [
    'Стоимость хода зависит от рассказчика и использованного контекста:',
    '',
    'DeepSeek V3.2, Grok 4.1 Fast, MiMo V2 Flash:',
    'до 6000 — 1 сол',
    '6001–16000 — 2 сола',
    '16001–32000 — 4 сола',
    '',
    'GLM 5.0, Aion Labs, Xiaomi MiMo V2 Pro:',
    'до 6000 — 2 сола',
    '6001–16000 — 4 сола',
    '16001–32000 — 8 солов',
    '',
    'GLM 5.1:',
    'до 6000 — 3 сола',
    '6001–16000 — 6 солов',
    '16001–32000 — 12 солов',
    'Эмбиент подсветка: +1 сол за ход',
    'Визуализация эмоций: +1 сол за ход',
  ].join('\n')
}

function getStoryTurnCostTokens(
  contextUsageTokens: number,
  narratorModelId: StoryNarratorModelId,
  ambientEnabled: boolean,
  emotionVisualizationEnabled = false,
): number {
  const normalizedUsage = Math.max(0, Math.round(contextUsageTokens))
  const [tier1Cost, tier2Cost, tier3Cost] = getStoryNarratorTurnCostTiers(narratorModelId)
  let totalCost = tier3Cost
  if (normalizedUsage <= STORY_TURN_COST_TIER_1_CONTEXT_LIMIT_MAX) {
    totalCost = tier1Cost
  } else if (normalizedUsage <= STORY_TURN_COST_TIER_2_CONTEXT_LIMIT_MAX) {
    totalCost = tier2Cost
  }
  if (ambientEnabled) {
    totalCost += 1
  }
  if (emotionVisualizationEnabled) {
    totalCost += 1
  }
  return totalCost
}

function clampStoryTopK(value: number): number {
  if (!Number.isFinite(value)) {
    return STORY_DEFAULT_TOP_K
  }
  return Math.min(STORY_TOP_K_MAX, Math.max(STORY_TOP_K_MIN, Math.round(value)))
}

function clampStoryRepetitionPenalty(value: number): number {
  if (!Number.isFinite(value)) {
    return STORY_DEFAULT_REPETITION_PENALTY
  }
  const clampedValue = Math.min(STORY_REPETITION_PENALTY_MAX, Math.max(STORY_REPETITION_PENALTY_MIN, value))
  return Math.round(clampedValue * 100) / 100
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
  const rawValue = (value ?? '').trim()
  const normalized = (rawValue === 'arcee-ai/trinity-large-preview:free' ? 'xiaomi/mimo-v2-flash' : rawValue) as StoryNarratorModelId
  if (STORY_NARRATOR_MODEL_OPTIONS.some((option) => option.id === normalized)) {
    return normalized
  }
  return STORY_DEFAULT_NARRATOR_MODEL_ID
}

function getStoryNarratorSamplingDefaults(modelId: StoryNarratorModelId): StoryNarratorSamplingDefaults {
  return STORY_NARRATOR_SAMPLING_DEFAULTS[normalizeStoryNarratorModelId(modelId)] ?? {
    storyTemperature: STORY_DEFAULT_TEMPERATURE,
    storyRepetitionPenalty: STORY_DEFAULT_REPETITION_PENALTY,
    storyTopK: STORY_DEFAULT_TOP_K,
    storyTopR: STORY_DEFAULT_TOP_R,
  }
}

function normalizeStoryImageModelId(value: string | null | undefined): StoryImageModelId {
  const normalized = (value ?? '').trim() as StoryImageModelId
  if (normalized === STORY_IMAGE_MODEL_GROK_LEGACY_ID) {
    return STORY_IMAGE_MODEL_GROK_ID
  }
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

function parseSortDate(rawValue: string | null | undefined): number {
  const parsed = Date.parse(String(rawValue || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function readEnvironmentString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

type EnvironmentSeasonValue = 'winter' | 'spring' | 'summer' | 'autumn'
type EnvironmentDateInfo = {
  title: string
  meta: string
  season: string
  month: string
  seasonAndMonth: string
}

const ENVIRONMENT_MONTH_OPTIONS: ReadonlyArray<{ value: string; label: string; season: EnvironmentSeasonValue }> = [
  { value: '1', label: 'Январь', season: 'winter' },
  { value: '2', label: 'Февраль', season: 'winter' },
  { value: '3', label: 'Март', season: 'spring' },
  { value: '4', label: 'Апрель', season: 'spring' },
  { value: '5', label: 'Май', season: 'spring' },
  { value: '6', label: 'Июнь', season: 'summer' },
  { value: '7', label: 'Июль', season: 'summer' },
  { value: '8', label: 'Август', season: 'summer' },
  { value: '9', label: 'Сентябрь', season: 'autumn' },
  { value: '10', label: 'Октябрь', season: 'autumn' },
  { value: '11', label: 'Ноябрь', season: 'autumn' },
  { value: '12', label: 'Декабрь', season: 'winter' },
]

const ENVIRONMENT_SEASON_OPTIONS: ReadonlyArray<{ value: EnvironmentSeasonValue; label: string }> = [
  { value: 'winter', label: 'Зима' },
  { value: 'spring', label: 'Весна' },
  { value: 'summer', label: 'Лето' },
  { value: 'autumn', label: 'Осень' },
]

function parseEnvironmentDateTimeValue(value: string | null | undefined): Date | null {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function resolveEnvironmentSeasonValueFromMonth(monthValue: string): EnvironmentSeasonValue {
  const normalizedMonth = Number(monthValue)
  const matchedOption = ENVIRONMENT_MONTH_OPTIONS.find((option) => Number(option.value) === normalizedMonth)
  return matchedOption?.season ?? 'summer'
}

function resolveEnvironmentMonthOptionsForSeason(
  seasonValue: EnvironmentSeasonValue,
): ReadonlyArray<{ value: string; label: string; season: EnvironmentSeasonValue }> {
  return ENVIRONMENT_MONTH_OPTIONS.filter((option) => option.season === seasonValue)
}

function resolveEnvironmentMonthLabel(monthValue: string): string {
  return ENVIRONMENT_MONTH_OPTIONS.find((option) => option.value === monthValue)?.label ?? 'Июнь'
}

function resolveEnvironmentSeasonLabelByValue(seasonValue: EnvironmentSeasonValue): string {
  return ENVIRONMENT_SEASON_OPTIONS.find((option) => option.value === seasonValue)?.label ?? 'Лето'
}

function resolveEnvironmentTimeDraftValue(value: string | null | undefined): string {
  const parsed = parseEnvironmentDateTimeValue(value)
  if (!parsed) {
    return '09:00'
  }
  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function resolveEnvironmentMonthDraftValue(value: string | null | undefined): string {
  const parsed = parseEnvironmentDateTimeValue(value)
  if (!parsed) {
    return '6'
  }
  return String(parsed.getMonth() + 1)
}

function resolveEnvironmentSeasonValueFromLabel(value: unknown): EnvironmentSeasonValue | null {
  const normalized = readEnvironmentString(value).toLocaleLowerCase()
  if (!normalized) {
    return null
  }
  if (normalized.includes('зим') || normalized.includes('winter')) {
    return 'winter'
  }
  if (normalized.includes('весн') || normalized.includes('spring')) {
    return 'spring'
  }
  if (normalized.includes('осен') || normalized.includes('autumn') || normalized.includes('fall')) {
    return 'autumn'
  }
  if (normalized.includes('лет') || normalized.includes('summer')) {
    return 'summer'
  }
  return null
}
function resolveEnvironmentMonthValueFromLabel(value: unknown): string | null {
  const normalized = readEnvironmentString(value).toLocaleLowerCase()
  if (!normalized) {
    return null
  }
  const matchedOption = ENVIRONMENT_MONTH_OPTIONS.find((option) => {
    const optionLabel = option.label.toLocaleLowerCase()
    return normalized === option.value || normalized === optionLabel
  })
  return matchedOption?.value ?? null
}

function resolveEnvironmentMonthDraftValueFromState(
  value: string | null | undefined,
  weatherValue: Record<string, unknown> | null | undefined,
): string {
  const monthFromWeather = resolveEnvironmentMonthValueFromLabel(weatherValue?.month)
  if (monthFromWeather) {
    return monthFromWeather
  }
  return resolveEnvironmentMonthDraftValue(value)
}

function resolveEnvironmentSeasonDraftValueFromState(
  value: string | null | undefined,
  weatherValue: Record<string, unknown> | null | undefined,
): EnvironmentSeasonValue {
  const seasonFromWeather = resolveEnvironmentSeasonValueFromLabel(weatherValue?.season)
  if (seasonFromWeather) {
    return seasonFromWeather
  }
  return resolveEnvironmentSeasonValueFromMonth(resolveEnvironmentMonthDraftValueFromState(value, weatherValue))
}

function buildEnvironmentDateTimeFromDraft(
  currentValue: string | null | undefined,
  monthValue: string,
  timeValue: string,
): string | null {
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeValue.trim())
  if (!timeMatch) {
    return null
  }
  const parsedMonth = Number(monthValue)
  const parsedHours = Number(timeMatch[1])
  const parsedMinutes = Number(timeMatch[2])
  if (
    !Number.isInteger(parsedMonth)
    || parsedMonth < 1
    || parsedMonth > 12
    || !Number.isInteger(parsedHours)
    || parsedHours < 0
    || parsedHours > 23
    || !Number.isInteger(parsedMinutes)
    || parsedMinutes < 0
    || parsedMinutes > 59
  ) {
    return null
  }
  const baseDate = parseEnvironmentDateTimeValue(currentValue) ?? new Date()
  const year = baseDate.getFullYear()
  const day = Math.min(baseDate.getDate(), new Date(year, parsedMonth, 0).getDate())
  const normalized = `${String(year).padStart(4, '0')}-${String(parsedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(parsedHours).padStart(2, '0')}:${String(parsedMinutes).padStart(2, '0')}`
  return normalizeEnvironmentDateTimeInputValue(normalized)
}

function resolveEnvironmentSummaryIcon(summaryValue: unknown): string {
  const summary = readEnvironmentString(summaryValue).toLowerCase()
  const matchesSnow =
    summary.includes('\u0441\u043d\u0435\u0433') ||
    summary.includes('\u043c\u0435\u0442\u0435\u043b') ||
    summary.includes('snow')
  const matchesFog =
    summary.includes('\u0442\u0443\u043c\u0430\u043d') ||
    summary.includes('\u0434\u044b\u043c\u043a') ||
    summary.includes('fog')
  const matchesRain =
    summary.includes('\u0434\u043e\u0436\u0434') ||
    summary.includes('\u043b\u0438\u0432') ||
    summary.includes('\u0433\u0440\u043e\u0437') ||
    summary.includes('rain') ||
    summary.includes('storm')
  const matchesClear =
    summary.includes('\u044f\u0441\u043d') ||
    summary.includes('\u0441\u043e\u043b\u043d\u0435\u0447') ||
    summary.includes('\u0431\u0435\u0437\u043e\u0431\u043b\u0430\u0447') ||
    summary.includes('clear') ||
    summary.includes('sunny')
  if (!summary) {
    return environmentCloudIcon
  }
  if (matchesSnow) {
    return environmentSnowIcon
  }
  if (matchesFog) {
    return environmentFogIcon
  }
  if (matchesRain) {
    return environmentUnderwaterIcon
  }
  if (matchesClear) {
    return environmentClearIcon
  }
  if (summary.includes('снег') || summary.includes('метел') || summary.includes('snow')) {
    return environmentSnowIcon
  }
  if (summary.includes('туман') || summary.includes('дымк') || summary.includes('fog')) {
    return environmentFogIcon
  }
  if (
    summary.includes('дожд') ||
    summary.includes('лив') ||
    summary.includes('гроз') ||
    summary.includes('rain') ||
    summary.includes('storm')
  ) {
    return environmentUnderwaterIcon
  }
  return environmentCloudIcon
}

function normalizeEnvironmentTimeline(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .sort(
      (leftEntry, rightEntry) =>
        resolveEnvironmentTimelineSortWeight(leftEntry, 0) - resolveEnvironmentTimelineSortWeight(rightEntry, 0),
    )
}

function formatEnvironmentDateInfo(
  value: string | null | undefined,
  weatherValue: Record<string, unknown> | null | undefined,
): EnvironmentDateInfo {
  return formatEnvironmentDisplayInfo(value, weatherValue)
}

function formatEnvironmentDisplayInfo(
  value: string | null | undefined,
  weatherValue: Record<string, unknown> | null | undefined,
): EnvironmentDateInfo {
  const parsed = parseEnvironmentDateTimeValue(value)
  const monthValue =
    resolveEnvironmentMonthValueFromLabel(weatherValue?.month)
    ?? (parsed ? String(parsed.getMonth() + 1) : '')
  const seasonValue =
    resolveEnvironmentSeasonValueFromLabel(weatherValue?.season)
    ?? (monthValue ? resolveEnvironmentSeasonValueFromMonth(monthValue) : null)
  const seasonLabel = seasonValue ? resolveEnvironmentSeasonLabelByValue(seasonValue) : ''
  const monthLabel = monthValue ? resolveEnvironmentMonthLabel(monthValue) : ''
  const seasonAndMonth = [seasonLabel, monthLabel].filter(Boolean).join(' • ')

  if (!parsed) {
    return {
      title: readEnvironmentString(value) || 'Дата неизвестна',
      meta: readEnvironmentString(weatherValue?.time_of_day) || 'Часть суток не определена',
      season: seasonLabel,
      month: monthLabel,
      seasonAndMonth,
    }
  }

  const activeTimelineIndex = resolveEnvironmentTimelineActiveIndex(parsed.toISOString())
  return {
    title: parsed.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    meta:
      readEnvironmentString(weatherValue?.time_of_day)
      || resolveEnvironmentTimelineLabel(
        createDefaultEnvironmentTimeline()[activeTimelineIndex] ?? {},
        activeTimelineIndex,
      ),
    season: seasonLabel,
    month: monthLabel,
    seasonAndMonth,
  }
}

function createDefaultEnvironmentTimeline(): Array<Record<string, unknown>> {
  return [
    { start_time: '00:00', end_time: '06:00', summary: '', temperature_c: null },
    { start_time: '06:00', end_time: '12:00', summary: '', temperature_c: null },
    { start_time: '12:00', end_time: '18:00', summary: '', temperature_c: null },
    { start_time: '18:00', end_time: '00:00', summary: '', temperature_c: null },
  ]
}

function resolveEnvironmentTimelineSortWeight(entry: Record<string, unknown>, index: number): number {
  const startTime = readEnvironmentString(entry.start_time)
  if (startTime.startsWith('00') || startTime.startsWith('22') || startTime.startsWith('23')) {
    return 0
  }
  if (startTime.startsWith('06')) {
    return 1
  }
  if (startTime.startsWith('12')) {
    return 2
  }
  if (startTime.startsWith('17') || startTime.startsWith('18')) {
    return 3
  }
  return index + 10
}

function resolveEnvironmentTimelineLabel(entry: Record<string, unknown>, index: number): string {
  const startTime = readEnvironmentString(entry.start_time)
  if (startTime.startsWith('06')) {
    return 'Утро'
  }
  if (startTime.startsWith('12')) {
    return 'День'
  }
  if (startTime.startsWith('17') || startTime.startsWith('18')) {
    return 'Вечер'
  }
  if (startTime.startsWith('22') || startTime.startsWith('23') || startTime.startsWith('00')) {
    return 'Ночь'
  }
  return ['Ночь', 'Утро', 'День', 'Вечер'][index] ?? `Блок ${index + 1}`
}

function resolveEnvironmentTimelineActiveIndex(currentDateTimeValue: string | null | undefined): number {
  const parsed = currentDateTimeValue ? new Date(currentDateTimeValue) : null
  const currentHour = parsed && !Number.isNaN(parsed.getTime()) ? parsed.getHours() : null
  if (currentHour === null) {
    return 0
  }
  if (currentHour < 6) {
    return 0
  }
  if (currentHour >= 6 && currentHour < 12) {
    return 1
  }
  if (currentHour >= 12 && currentHour < 18) {
    return 2
  }
  if (currentHour >= 18 && currentHour < 24) {
    return 3
  }
  return 0
}

function normalizeEnvironmentDateTimeInputValue(value: string): string | null {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }
  return normalized.length === 16 ? `${normalized}:00` : normalized
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
    const title = toStoryText(plotCard.title).replace(/\s+/g, ' ').trim()
    const content = toStoryText(plotCard.content).replace(/\r\n/g, '\n').trim()
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

function estimateStructuredCardsTokens(cards: Array<{ title: string; content: string }>): number {
  if (cards.length === 0) {
    return 0
  }
  const payload = cards
    .map((card, index) => ({
      title: toStoryText(card.title).replace(/\s+/g, ' ').trim(),
      content: toStoryText(card.content).replace(/\r\n/g, '\n').trim(),
      index,
    }))
    .filter((card) => card.title.length > 0 && card.content.length > 0)
    .map((card) => `${card.index + 1}. ${card.title}: ${card.content}`)
    .join('\n')
  return payload ? estimateTextTokens(payload) : 0
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
    const content = toStoryText(message.content).replace(/\r\n/g, '\n').trim()
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
  if (card.kind === 'main_hero' || card.kind === 'world_profile') {
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

const STORY_WORLD_CARD_AI_ACCESS_TOOLTIP = 'ИИ имеет доступ к редактированию карточки.'

function supportsWorldCardAiStateUi(card: Pick<StoryWorldCard, 'kind'>) {
  return card.kind === 'main_hero' || card.kind === 'npc'
}

function renderWorldCardAiAccessBadge(card: Pick<StoryWorldCard, 'ai_edit_enabled'>) {
  if (!card.ai_edit_enabled) {
    return null
  }

  return (
    <Tooltip arrow placement="top" title={STORY_WORLD_CARD_AI_ACCESS_TOOLTIP}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--morius-title-text)',
          opacity: 0.94,
          lineHeight: 0,
        }}
      >
        <ThemedSvgIcon markup={aiEditIconMarkup} size={14} />
      </Box>
    </Tooltip>
  )
}

function plotCardUsesTriggerMode(card: Pick<StoryPlotCard, 'triggers'>): boolean {
  return card.triggers.some((trigger) => trigger.trim().length > 0)
}

function isPlotCardManuallyDisabled(card: Pick<StoryPlotCard, 'triggers' | 'is_enabled'>): boolean {
  return !plotCardUsesTriggerMode(card) && !card.is_enabled
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
    return `активна В? +${memoryTurns} ${formatTurnsWord(memoryTurns)}`
  }
  return `активна В? ${state.turnsRemaining} ${formatTurnsWord(state.turnsRemaining)}`
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
    return `активна В? +${memoryTurns} ${formatTurnsWord(memoryTurns)}`
  }
  return `активна В? ${state.turnsRemaining} ${formatTurnsWord(state.turnsRemaining)}`
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
    const tokens = normalizeStoryMatchTokens(toStoryText(message.content).replace(/\r\n/g, '\n').trim())
    if (tokens.length === 0) {
      return
    }
    turnTokenEntries.push({ turnIndex: currentTurnIndex, tokens })
  })

  const stateById = new Map<number, WorldCardContextState>()
  worldCards.forEach((card) => {
    const memoryTurns = resolveWorldCardMemoryTurns(card)
    if (card.kind === 'main_hero' || card.kind === 'world_profile') {
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

    const fallbackTrigger = toStoryText(card.title).replace(/\s+/g, ' ').trim()
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
      if (turnsSinceTrigger < memoryTurns) {
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
    const tokens = normalizeStoryMatchTokens(toStoryText(message.content).replace(/\r\n/g, '\n').trim())
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

    if (triggers.length === 0 && !card.is_enabled) {
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
      if (turnsSinceTrigger < memoryTurns) {
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
  return (
    <ProgressiveAvatar
      src={avatarUrl}
      fallbackLabel={fallbackLabel}
      size={size}
      scale={avatarScale}
      sx={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        aspectRatio: '1 / 1',
      }}
    />
  )
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

const MISSING_MAIN_HERO_DIALOG_SUPPRESS_KEY = 'morius:missing-main-hero-dialog:suppress'

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
    activeTheme,
    storyHistoryFontFamily,
    storyHistoryFontWeight,
    voiceInputEnabled,
    storyHistoryFontFamilyOptions,
    storyHistoryFontWeightOptions,
  } = useMoriusThemeController()
  const isGrayTheme = themeId === 'gray'
  const isYamiTheme = themeId === 'yami-rius'
  const rightPanelActiveTabColor = 'var(--morius-accent)'
  const assistantReplyTextColor = activeTheme.story?.assistantTextColor ?? (isGrayTheme ? '#CECECE' : 'var(--morius-title-text)')
  const playerMessageColor = activeTheme.story?.playerTextColor ?? (isGrayTheme ? '#808080' : 'var(--morius-text-secondary)')
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
  const sendButtonIconColor = 'var(--morius-accent)'
  const getComposerTopActionButtonSx = (options?: { highlighted?: boolean }) => ({
    width: COMPOSER_TOP_ACTION_BUTTON_SIZE,
    height: COMPOSER_TOP_ACTION_BUTTON_SIZE,
    minWidth: COMPOSER_TOP_ACTION_BUTTON_SIZE,
    minHeight: COMPOSER_TOP_ACTION_BUTTON_SIZE,
    borderRadius: '14px',
    border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 90%, transparent)',
    backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 76%, #000 24%) !important',
    boxShadow: '0 8px 18px color-mix(in srgb, #000 26%, transparent)',
    color: options?.highlighted ? 'var(--morius-accent)' : secondaryGameButtonColor,
    transition: 'color 160ms ease, opacity 160ms ease, transform 160ms ease, background-color 160ms ease, border-color 160ms ease',
    '&:hover': {
      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 68%, #000 32%) !important',
      borderColor: 'color-mix(in srgb, var(--morius-accent) 44%, var(--morius-card-border))',
      color: 'var(--morius-accent)',
    },
    '&:active': {
      transform: 'translateY(1px)',
      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 62%, #000 38%) !important',
    },
    '&:disabled': {
      opacity: 0.46,
      color: options?.highlighted ? 'var(--morius-accent)' : secondaryGameButtonColor,
      borderColor: 'color-mix(in srgb, var(--morius-card-border) 75%, transparent)',
      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, #000 14%) !important',
    },
  })
  const composerActionImageSx = {
    width: 18,
    height: 18,
    opacity: 0.9,
  }
  const overflowActionButtonSx = {
    width: 26,
    height: 26,
    minWidth: 26,
    minHeight: 26,
    p: 0,
    border: 'none',
    borderRadius: '999px',
    backgroundColor: 'transparent !important',
    color: 'var(--morius-accent)',
    opacity: 0,
    pointerEvents: 'none',
    transition: 'opacity 160ms ease, color 160ms ease, transform 160ms ease',
    '&:hover': {
      backgroundColor: 'transparent !important',
      color: 'var(--morius-accent)',
      transform: 'scale(1.04)',
    },
    '&:active': {
      backgroundColor: 'transparent !important',
    },
    '&.Mui-focusVisible': {
      backgroundColor: 'transparent !important',
      opacity: 1,
    },
    '&:disabled': {
      opacity: 0.42,
      color: 'var(--morius-accent)',
      backgroundColor: 'transparent !important',
    },
  } as const
  const cardsPanelIconSx = (isActive: boolean) => ({
    color: `${isActive ? 'var(--morius-accent)' : 'var(--morius-title-text)'} !important`,
    opacity: isActive ? 1 : 0.86,
    '& svg': {
      color: 'inherit !important',
    },
  })
  const environmentPanelIconSx = {
    width: 22,
    height: 22,
    display: 'block',
    opacity: 0.96,
    filter: 'brightness(0) saturate(100%) invert(93%) sepia(9%) saturate(257%) hue-rotate(187deg) brightness(103%) contrast(96%)',
  }
  const activeStatusChipTextColor = 'rgba(170, 238, 191, 0.96)'
  const activeStatusChipBorderColor = 'rgba(128, 213, 162, 0.46)'
  const activeStatusChipBackgroundColor = 'rgba(46, 92, 66, 0.18)'
  const inactiveStatusChipTextColor = 'rgba(176, 188, 207, 0.74)'
  const inactiveStatusChipBorderColor = 'rgba(137, 154, 178, 0.38)'
  const buildStatusChipSx = (isActive: boolean) => ({
    px: 0.8,
    py: 0.28,
    borderRadius: '999px',
    border: isActive
      ? `var(--morius-border-width) solid ${activeStatusChipBorderColor}`
      : `var(--morius-border-width) solid ${inactiveStatusChipBorderColor}`,
    backgroundColor: isActive ? activeStatusChipBackgroundColor : 'transparent',
    color: isActive ? activeStatusChipTextColor : inactiveStatusChipTextColor,
    fontSize: '0.68rem',
    lineHeight: 1,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0.22,
  })
  const rightPanelModeButtonSx = (isActive: boolean) => ({
    width: 'var(--morius-action-size)',
    height: 'var(--morius-action-size)',
    borderRadius: '999px',
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
        color: 'var(--morius-accent) !important',
      },
    },
    '&:active': {
      backgroundColor: 'transparent !important',
    },
  })
  const rightPanelTextTabButtonSx = (isActive: boolean, accentActive = true) => ({
    '&&&': {
      color: `${isActive ? (accentActive ? rightPanelActiveTabColor : 'var(--morius-title-text)') : 'var(--morius-title-text)'} !important`,
      opacity: 1,
      fontWeight: isActive ? 850 : 650,
      backgroundColor: 'transparent !important',
      border: 'none',
      boxShadow: 'none',
    },
    textTransform: 'none',
    transition: 'color 160ms ease, transform 160ms ease, opacity 160ms ease',
    '&&& .MuiTypography-root, &&& .MuiBox-root, &&& svg, &&& path': {
      color: 'inherit !important',
      fill: 'currentColor !important',
      stroke: 'currentColor !important',
    },
    '&&&:hover': {
      backgroundColor: 'transparent !important',
      color: `${accentActive ? 'var(--morius-accent)' : 'var(--morius-title-text)'} !important`,
      boxShadow: 'none',
    },
    '&&&:active': {
      backgroundColor: 'transparent !important',
      transform: 'translateY(1px)',
    },
    '&&&.Mui-focusVisible': {
      backgroundColor: 'transparent !important',
      boxShadow: 'none',
    },
  })
  const environmentEditorFieldSx = {
    '& .MuiInputLabel-root': {
      color: 'var(--morius-text-secondary)',
    },
    '& .MuiInputLabel-root.Mui-focused': {
      color: 'var(--morius-accent)',
    },
    '& .MuiOutlinedInput-root': {
      borderRadius: '14px',
      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 72%, #000 28%)',
      color: 'var(--morius-title-text)',
      '& fieldset': {
        borderColor: 'color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
      },
      '&:hover fieldset': {
        borderColor: 'color-mix(in srgb, var(--morius-accent) 34%, var(--morius-card-border))',
      },
      '&.Mui-focused fieldset': {
        borderColor: 'color-mix(in srgb, var(--morius-accent) 56%, var(--morius-card-border))',
      },
    },
    '& .MuiOutlinedInput-input': {
      color: 'var(--morius-title-text)',
      '&[type="datetime-local"]': {
        colorScheme: 'dark',
      },
      '&[type="datetime-local"]::-webkit-calendar-picker-indicator': {
        filter:
          'brightness(0) saturate(100%) invert(91%) sepia(8%) saturate(325%) hue-rotate(183deg) brightness(104%) contrast(95%)',
        opacity: 0.92,
        cursor: 'pointer',
      },
    },
    '& .MuiSvgIcon-root': {
      color: 'var(--morius-text-secondary)',
    },
  } as const
  const rightPanelActionButtonSx = {
    borderRadius: '13px',
    textTransform: 'none',
    fontWeight: 700,
    fontSize: '0.98rem',
    color: 'var(--morius-title-text)',
    border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 92%, transparent)',
    backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #000 18%)',
    boxShadow: 'inset 0 1px 0 color-mix(in srgb, #fff 8%, transparent)',
    '&:hover': {
      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 72%, #000 28%)',
      borderColor: isYamiTheme
        ? 'var(--morius-card-border)'
        : 'color-mix(in srgb, var(--morius-accent) 58%, var(--morius-card-border))',
      boxShadow: 'inset 0 1px 0 color-mix(in srgb, #fff 10%, transparent)',
    },
    '&:active': {
      transform: 'translateY(1px)',
      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 66%, #000 34%)',
    },
  } as const
  const rightPanelCompactActionButtonSx = {
    ...rightPanelActionButtonSx,
    minHeight: 40,
    borderRadius: '12px',
    fontSize: '0.94rem',
  } as const
  const [, setGames] = useState<StoryGameSummary[]>([])
  const [activeGameSummary, setActiveGameSummary] = useState<StoryGameSummary | null>(null)
  const [activeGameId, setActiveGameId] = useState<number | null>(null)
  const [environmentEditorOpen, setEnvironmentEditorOpen] = useState(false)
  const [environmentLocationDraft, setEnvironmentLocationDraft] = useState('')
  const [environmentSeasonDraft, setEnvironmentSeasonDraft] = useState<EnvironmentSeasonValue>('summer')
  const [environmentMonthDraft, setEnvironmentMonthDraft] = useState('6')
  const [environmentTimeDraft, setEnvironmentTimeDraft] = useState('09:00')
  const [environmentCurrentSummaryDraft, setEnvironmentCurrentSummaryDraft] = useState('')
  const [isSavingEnvironmentPanel, setIsSavingEnvironmentPanel] = useState(false)
  const [isRegeneratingEnvironmentWeather, setIsRegeneratingEnvironmentWeather] = useState(false)
  const [messages, setMessages] = useState<StoryMessage[]>([])
  const [hasOlderStoryMessages, setHasOlderStoryMessages] = useState(false)
  const [isLoadingOlderStoryMessages, setIsLoadingOlderStoryMessages] = useState(false)
  const [visibleAssistantTurns, setVisibleAssistantTurns] = useState(STORY_VISIBLE_ASSISTANT_TURNS_INITIAL)
  const [ambientByAssistantMessageId, setAmbientByAssistantMessageId] = useState<Record<number, StoryAmbientProfile>>({})
  const [inputValue, setInputValue] = useState('')
  const [isMobileComposer, setIsMobileComposer] = useState<boolean>(() => isMobileComposerViewport())
  const [isComposerAiMenuOpen, setIsComposerAiMenuOpen] = useState(false)
  const [isVoiceInputActive, setIsVoiceInputActive] = useState(false)
  const [quickStartIntro, setQuickStartIntro] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoadingGameMessages, setIsLoadingGameMessages] = useState(false)
  const [isBootstrappingGameData, setIsBootstrappingGameData] = useState(true)
  const [isCreatingGame, setIsCreatingGame] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isFinalizingStoryTurn, setIsFinalizingStoryTurn] = useState(false)
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
  const [activeAiPanelTab, setActiveAiPanelTab] = useState<AiPanelTab>('settings')
  const [activeWorldPanelTab, setActiveWorldPanelTab] = useState<WorldPanelTab>('story')
  const [cardsPanelTab, setCardsPanelTab] = useState<CardsPanelTab>('world')
  const [cardsViewMode, setCardsViewMode] = useState<'compact' | 'full'>(() => {
    try { return (localStorage.getItem('morius-cards-view-mode') as 'compact' | 'full') ?? 'full' } catch { return 'full' }
  })
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
  const [paymentReferralBonusCoins, setPaymentReferralBonusCoins] = useState(0)
  const [customTitleMap, setCustomTitleMap] = useState<StoryTitleMap>({})
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [isSavingMessage, setIsSavingMessage] = useState(false)
  const inlineMessageSaveRevisionRef = useRef<Map<number, number>>(new Map())
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
  const [advancedRegenerationEnabled, setAdvancedRegenerationEnabled] = useState(false)
  const [advancedRegenerationDialogOpen, setAdvancedRegenerationDialogOpen] = useState(false)
  const [selectedSmartRegenerationMode, setSelectedSmartRegenerationMode] = useState<SmartRegenerationMode>(
    DEFAULT_SMART_REGENERATION_MODE,
  )
  const [selectedSmartRegenerationOptions, setSelectedSmartRegenerationOptions] = useState<SmartRegenerationOption[]>(
    DEFAULT_SMART_REGENERATION_OPTIONS,
  )
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
  const [characterManagerSyncCardKind, setCharacterManagerSyncCardKind] = useState<StoryWorldCardKind | null>(null)
  const [characterManagerSyncCardMemoryTurnsDraft, setCharacterManagerSyncCardMemoryTurnsDraft] =
    useState<NpcMemoryTurnsOption>(NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS)
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
  const [characterRaceOptions, setCharacterRaceOptions] = useState<StoryCharacterRace[]>([])
  const [hasLoadedCharacterRaces, setHasLoadedCharacterRaces] = useState(false)
  const [isLoadingCharacterRaces, setIsLoadingCharacterRaces] = useState(false)
  const [isSavingCharacterRace, setIsSavingCharacterRace] = useState(false)
  const [isLoadingCommunityCharacterOptions, setIsLoadingCommunityCharacterOptions] = useState(false)
  const [hasLoadedCommunityCharacterOptions, setHasLoadedCommunityCharacterOptions] = useState(false)
  const [expandedCommunityCharacterId, setExpandedCommunityCharacterId] = useState<number | null>(null)
  const [loadingCommunityCharacterId, setLoadingCommunityCharacterId] = useState<number | null>(null)
  const [savingCommunityCharacterId, setSavingCommunityCharacterId] = useState<number | null>(null)
  const [worldCardAvatarTargetId, setWorldCardAvatarTargetId] = useState<number | null>(null)
  const [worldCardAvatarTargetMode, setWorldCardAvatarTargetMode] = useState<'persisted' | 'draft' | null>(null)
  const [worldCardAvatarCropSource, setWorldCardAvatarCropSource] = useState<string | null>(null)
  const [worldCardCharacterMirrorByCardId, setWorldCardCharacterMirrorByCardId] = useState<Record<number, number>>({})
  const [isSavingWorldCardAvatar, setIsSavingWorldCardAvatar] = useState(false)
  const [worldCardEvents, setWorldCardEvents] = useState<StoryWorldCardEvent[]>([])
  const [canRedoAssistantStepServer, setCanRedoAssistantStepServer] = useState(false)
  const [dismissedWorldCardEventIds, setDismissedWorldCardEventIds] = useState<number[]>([])
  const [expandedWorldCardEventIds, setExpandedWorldCardEventIds] = useState<number[]>([])
  const [undoingWorldCardEventIds, setUndoingWorldCardEventIds] = useState<number[]>([])
  const [worldCardDialogOpen, setWorldCardDialogOpen] = useState(false)
  const [worldCardCloseConfirmOpen, setWorldCardCloseConfirmOpen] = useState(false)
  const [editingWorldCardId, setEditingWorldCardId] = useState<number | null>(null)
  const [editingWorldCardKind, setEditingWorldCardKind] = useState<StoryWorldCardKind>('world')
  const [worldCardTitleDraft, setWorldCardTitleDraft] = useState('')
  const [worldCardContentDraft, setWorldCardContentDraft] = useState('')
  const [worldCardDetailTypeDraft, setWorldCardDetailTypeDraft] = useState('')
  const [isSavingWorldDetailType, setIsSavingWorldDetailType] = useState(false)
  const [worldCardRaceDraft, setWorldCardRaceDraft] = useState('')
  const [worldCardRaceInputDraft, setWorldCardRaceInputDraft] = useState('')
  const [worldCardClothingDraft, setWorldCardClothingDraft] = useState('')
  const [worldCardInventoryDraft, setWorldCardInventoryDraft] = useState('')
  const [worldCardHealthStatusDraft, setWorldCardHealthStatusDraft] = useState('')
  const [worldCardTriggersDraft, setWorldCardTriggersDraft] = useState('')
  const [worldCardMemoryTurnsDraft, setWorldCardMemoryTurnsDraft] = useState<NpcMemoryTurnsOption>(NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS)
  const [worldCardAvatarDraft, setWorldCardAvatarDraft] = useState<string | null>(null)
  const [worldCardAvatarOriginalDraft, setWorldCardAvatarOriginalDraft] = useState<string | null>(null)
  const [worldCardAvatarScaleDraft, setWorldCardAvatarScaleDraft] = useState(1)
  const [isWorldCardAvatarDraftDirty, setIsWorldCardAvatarDraftDirty] = useState(false)
  const [isWorldCardAdditionalExpanded, setIsWorldCardAdditionalExpanded] = useState(false)
  const [isSavingWorldCard, setIsSavingWorldCard] = useState(false)
  const [updatingWorldCardAiEditId, setUpdatingWorldCardAiEditId] = useState<number | null>(null)
  const [deletingWorldCardId, setDeletingWorldCardId] = useState<number | null>(null)
  const [worldCardTemplatePickerOpen, setWorldCardTemplatePickerOpen] = useState(false)
  const [worldCardTemplatePickerKind, setWorldCardTemplatePickerKind] = useState<'world' | 'world_profile'>('world')
  const [worldDetailTypeOptions, setWorldDetailTypeOptions] = useState<StoryWorldDetailType[]>([])
  const [hasLoadedWorldDetailTypes, setHasLoadedWorldDetailTypes] = useState(false)
  const [isLoadingWorldDetailTypes, setIsLoadingWorldDetailTypes] = useState(false)
  const [mainHeroPreviewOpen, setMainHeroPreviewOpen] = useState(false)
  const [characterAvatarPreview, setCharacterAvatarPreview] = useState<{ url: string; name: string } | null>(null)
  const [contextLimitChars, setContextLimitChars] = useState(STORY_DEFAULT_CONTEXT_LIMIT)
  const [contextLimitDraft, setContextLimitDraft] = useState(String(STORY_DEFAULT_CONTEXT_LIMIT))
  const [isNarratorSettingsExpanded, setIsNarratorSettingsExpanded] = useState(false)
  const [isVisualizationSettingsExpanded, setIsVisualizationSettingsExpanded] = useState(false)
  const [isAdditionalSettingsExpanded, setIsAdditionalSettingsExpanded] = useState(false)
  const [isFineTuneSettingsExpanded, setIsFineTuneSettingsExpanded] = useState(false)
  const [smoothStreamingEnabled, setSmoothStreamingEnabled] = useState(() => readSmoothStreamingPreference())
  const [isContextUsageExpanded, setIsContextUsageExpanded] = useState(false)
  const [isSavingContextLimit, setIsSavingContextLimit] = useState(false)
  const [contextBudgetWarning, setContextBudgetWarning] = useState<{
    recommendedLimit: number
    plotOverflowTokens: number
  } | null>(null)
  const [responseMaxTokens, setResponseMaxTokens] = useState(STORY_DEFAULT_RESPONSE_MAX_TOKENS)
  const [responseMaxTokensEnabled, setResponseMaxTokensEnabled] = useState(false)
  const [isSavingResponseMaxTokens, setIsSavingResponseMaxTokens] = useState(false)
  const [isSavingResponseMaxTokensEnabled, setIsSavingResponseMaxTokensEnabled] = useState(false)
  const [storyLlmModel, setStoryLlmModel] = useState<StoryNarratorModelId>(STORY_DEFAULT_NARRATOR_MODEL_ID)
  const [storyImageModel, setStoryImageModel] = useState<StoryImageModelId>(STORY_DEFAULT_IMAGE_MODEL_ID)
  const [imageStylePromptDraft, setImageStylePromptDraft] = useState('')
  const [memoryOptimizationEnabled, setMemoryOptimizationEnabled] = useState(true)
  const [memoryOptimizationMode, setMemoryOptimizationMode] = useState<StoryMemoryOptimizationMode>('standard')
  const [storyTemperature, setStoryTemperature] = useState(STORY_DEFAULT_TEMPERATURE)
  const [storyRepetitionPenalty, setStoryRepetitionPenalty] = useState(STORY_DEFAULT_REPETITION_PENALTY)
  const [storyRepetitionPenaltyDraft, setStoryRepetitionPenaltyDraft] = useState(
    STORY_DEFAULT_REPETITION_PENALTY.toFixed(2),
  )
  const [storyTopK, setStoryTopK] = useState(STORY_DEFAULT_TOP_K)
  const [storyTopR, setStoryTopR] = useState(STORY_DEFAULT_TOP_R)
  const [showGgThoughts, setShowGgThoughts] = useState(false)
  const [showNpcThoughts, setShowNpcThoughts] = useState(false)
  const [ambientEnabled, setAmbientEnabled] = useState(false)
  const [characterStateEnabled, setCharacterStateEnabled] = useState(false)
  const [emotionVisualizationEnabled, setEmotionVisualizationEnabled] = useState(false)
  const [canonicalStatePipelineEnabled, setCanonicalStatePipelineEnabled] = useState(true)
  const [canonicalStateSafeFallbackEnabled, setCanonicalStateSafeFallbackEnabled] = useState(false)
  const [persistedAmbientProfile, setPersistedAmbientProfile] = useState<StoryAmbientProfile | null>(null)
  const [storySettingsOverrides, setStorySettingsOverrides] = useState<Record<number, StorySettingsOverride>>({})
  const storySettingsOverridesRef = useRef<Record<number, StorySettingsOverride>>({})
  const cardsPanelTabsScrollerRef = useRef<HTMLDivElement | null>(null)
  const cardsPanelTabsDragStateRef = useRef<{
    pointerId: number | null
    startX: number
    startY: number
    scrollLeft: number
    isDragging: boolean
    suppressClick: boolean
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    isDragging: false,
    suppressClick: false,
  })
  const [isSavingStoryLlmModel, setIsSavingStoryLlmModel] = useState(false)
  const [isSavingStoryImageModel, setIsSavingStoryImageModel] = useState(false)
  const [isSavingImageStylePrompt, setIsSavingImageStylePrompt] = useState(false)
  const [isSavingMemoryOptimization, setIsSavingMemoryOptimization] = useState(false)
  const [isSavingStorySampling, setIsSavingStorySampling] = useState(false)
  const isSavingShowGgThoughts = false
  const [isSavingShowNpcThoughts, setIsSavingShowNpcThoughts] = useState(false)
  const [isSavingAmbientEnabled, setIsSavingAmbientEnabled] = useState(false)
  const [isSavingCharacterStateEnabled, setIsSavingCharacterStateEnabled] = useState(false)
  const [isSavingEmotionVisualizationEnabled, setIsSavingEmotionVisualizationEnabled] = useState(false)
  const [isSavingCanonicalStatePipeline, setIsSavingCanonicalStatePipeline] = useState(false)
  const [isSavingCanonicalStateSafeFallback, setIsSavingCanonicalStateSafeFallback] = useState(false)
  const [cardMenuAnchorEl, setCardMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [cardMenuType, setCardMenuType] = useState<PanelCardMenuType | null>(null)
  const [cardMenuCardId, setCardMenuCardId] = useState<number | null>(null)
  const [deletionPrompt, setDeletionPrompt] = useState<DeletionPrompt | null>(null)
  const [missingMainHeroDialogOpen, setMissingMainHeroDialogOpen] = useState(false)
  const [tutorialGameId, setTutorialGameId] = useState<number | null>(null)
  const [bugReportDialogOpen, setBugReportDialogOpen] = useState(false)
  const [bugReportTitleDraft, setBugReportTitleDraft] = useState('')
  const [bugReportDescriptionDraft, setBugReportDescriptionDraft] = useState('')
  const [isBugReportSubmitting, setIsBugReportSubmitting] = useState(false)
  const [characterMenuAnchorEl, setCharacterMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [characterMenuCharacterId, setCharacterMenuCharacterId] = useState<number | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const pendingContextBudgetCheckRef = useRef(false)
  const hiddenContinueTempUserMessageIdRef = useRef<number | null>(null)
  const turnImageAbortControllersRef = useRef<Map<number, AbortController>>(new Map())
  const imageStylePromptByGameRef = useRef<Record<number, string>>({})
  const activeGameIdRef = useRef<number | null>(null)
  const rightPanelResizingRef = useRef(false)
  const instructionDialogGameIdRef = useRef<number | null>(null)
  const plotCardDialogGameIdRef = useRef<number | null>(null)
  const worldCardDialogGameIdRef = useRef<number | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const composerAiButtonRef = useRef<HTMLButtonElement | null>(null)
  const composerAiMenuRef = useRef<HTMLDivElement | null>(null)
  const composerContainerRef = useRef<HTMLDivElement | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const isExpandingMessagesWindowRef = useRef(false)
  const pendingMessagesWindowAnchorRef = useRef<{ previousScrollHeight: number; previousScrollTop: number } | null>(null)
  const emotionStagePanelRef = useRef<HTMLDivElement | null>(null)
  const emotionStageResizingRef = useRef(false)
  const voiceRecognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const voiceSessionRequestedRef = useRef(false)
  const hasVoiceTranscriptRef = useRef(false)
  const voiceBasePromptRef = useRef('')
  const voiceFinalTranscriptRef = useRef('')
  const missingMainHeroPromptedGameIdRef = useRef<number | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const characterAvatarInputRef = useRef<HTMLInputElement | null>(null)
  const worldCardAvatarInputRef = useRef<HTMLInputElement | null>(null)
  const [composerHeight, setComposerHeight] = useState(0)
  const [emotionStageHeightPx, setEmotionStageHeightPx] = useState<number | null>(null)

  const activeDisplayTitle = useMemo(
    () => getDisplayStoryTitle(activeGameId, customTitleMap),
    [activeGameId, customTitleMap],
  )

  const handleOpenCharacterAvatarPreview = useCallback((event: ReactMouseEvent<HTMLElement>, avatarUrl: string | null, fallbackName: string) => {
    const resolvedAvatarUrl = resolveApiResourceUrl(avatarUrl)
    if (!resolvedAvatarUrl) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setCharacterAvatarPreview({
      url: resolvedAvatarUrl,
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
    setAdvancedRegenerationDialogOpen(false)
    setSelectedSmartRegenerationMode(DEFAULT_SMART_REGENERATION_MODE)
    setSelectedSmartRegenerationOptions(DEFAULT_SMART_REGENERATION_OPTIONS)
    if (!activeGameId) {
      setAdvancedRegenerationEnabled(false)
      return
    }
    try {
      const storageKey = buildAdvancedRegenerationStorageKey(user.id, activeGameId)
      setAdvancedRegenerationEnabled(localStorage.getItem(storageKey) === '1')
    } catch {
      setAdvancedRegenerationEnabled(false)
    }
  }, [activeGameId, user.id])

  useEffect(() => {
    setIsAutoScrollPaused(false)
    setContinueHiddenForMessageId(null)
    setHiddenUserMessageIds([])
    setHasOlderStoryMessages(false)
    setIsLoadingOlderStoryMessages(false)
    setVisibleAssistantTurns(STORY_VISIBLE_ASSISTANT_TURNS_INITIAL)
    isExpandingMessagesWindowRef.current = false
    pendingMessagesWindowAnchorRef.current = null
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
  const messagesWindowStartIndex = useMemo(
    () => resolveMessagesWindowStartIndex(messages, visibleAssistantTurns),
    [messages, visibleAssistantTurns],
  )
  const renderedMessages = useMemo(
    () => messages.slice(messagesWindowStartIndex),
    [messages, messagesWindowStartIndex],
  )
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
      maxWidth: STORY_STAGE_MAX_WIDTH,
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
  const getEmotionStageHeightBounds = useCallback(() => {
    const viewportHeight = Math.max(
      540,
      Math.round(messagesViewportRef.current?.clientHeight ?? window.innerHeight * 0.74),
    )
    const minHeight = Math.min(Math.max(EMOTION_STAGE_MIN_HEIGHT_PX, Math.round(viewportHeight * 0.28)), viewportHeight - 120)
    const maxHeight = Math.max(minHeight + 40, Math.round(viewportHeight * EMOTION_STAGE_MAX_HEIGHT_RATIO))
    const defaultHeight = Math.min(maxHeight, Math.max(minHeight, Math.round(viewportHeight * EMOTION_STAGE_DEFAULT_HEIGHT_RATIO)))
    return { minHeight, maxHeight, defaultHeight }
  }, [])
  const clampEmotionStageHeight = useCallback(
    (value: number) => {
      const { minHeight, maxHeight } = getEmotionStageHeightBounds()
      return Math.min(maxHeight, Math.max(minHeight, Math.round(value)))
    },
    [getEmotionStageHeightBounds],
  )
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
  const selectedNarratorSamplingDefaults = useMemo(
    () => getStoryNarratorSamplingDefaults(storyLlmModel),
    [storyLlmModel],
  )

  const applyStoryGameSettings = useCallback((game: StoryGameSummary) => {
    const normalizedContextLimit = clampStoryContextLimit(game.context_limit_chars)
    setContextLimitChars(normalizedContextLimit)
    setContextLimitDraft(String(normalizedContextLimit))
    const runtimeGame = game as Partial<StoryGameSummary>
    const normalizedRuntimeStoryModel = normalizeStoryNarratorModelId(runtimeGame.story_llm_model)
    const runtimeSamplingDefaults = getStoryNarratorSamplingDefaults(normalizedRuntimeStoryModel)
    const normalizedRuntimeMemoryOptimizationMode = normalizeStoryMemoryOptimizationMode(runtimeGame.memory_optimization_mode)
    const normalizedRuntimeStoryTemperature =
      typeof runtimeGame.story_temperature === 'number'
        ? clampStoryTemperature(runtimeGame.story_temperature)
        : runtimeSamplingDefaults.storyTemperature
    const normalizedRuntimeStoryRepetitionPenalty =
      typeof runtimeGame.story_repetition_penalty === 'number'
        ? clampStoryRepetitionPenalty(runtimeGame.story_repetition_penalty)
        : runtimeSamplingDefaults.storyRepetitionPenalty
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
    const normalizedRuntimeCanonicalStatePipelineEnabled = runtimeGame.canonical_state_pipeline_enabled !== false
    const normalizedRuntimeCanonicalStateSafeFallbackEnabled = Boolean(
      runtimeGame.canonical_state_safe_fallback_enabled,
    )
    const override = storySettingsOverridesRef.current[game.id]
    if (override) {
      setStoryLlmModel(override.storyLlmModel)
      setResponseMaxTokens(clampStoryResponseMaxTokens(override.responseMaxTokens))
      setResponseMaxTokensEnabled(override.responseMaxTokensEnabled)
      setMemoryOptimizationEnabled(true)
      setMemoryOptimizationMode(override.memoryOptimizationMode ?? normalizedRuntimeMemoryOptimizationMode)
      setStoryTemperature(clampStoryTemperature(override.storyTemperature ?? normalizedRuntimeStoryTemperature))
      setStoryRepetitionPenalty(
        clampStoryRepetitionPenalty(override.storyRepetitionPenalty ?? normalizedRuntimeStoryRepetitionPenalty),
      )
      setStoryRepetitionPenaltyDraft(
        clampStoryRepetitionPenalty(override.storyRepetitionPenalty ?? normalizedRuntimeStoryRepetitionPenalty).toFixed(2),
      )
      setStoryTopK(clampStoryTopK(override.storyTopK))
      setStoryTopR(clampStoryTopR(override.storyTopR))
      setShowGgThoughts(false)
      setShowNpcThoughts(override.showNpcThoughts)
      setAmbientEnabled(override.ambientEnabled)
      if (typeof override.characterStateEnabled === 'boolean') {
        setCharacterStateEnabled(override.characterStateEnabled)
      } else if (typeof runtimeGame.character_state_enabled === 'boolean') {
        setCharacterStateEnabled(runtimeGame.character_state_enabled)
      } else {
        setCharacterStateEnabled(false)
      }
      if (typeof override.emotionVisualizationEnabled === 'boolean') {
        setEmotionVisualizationEnabled(override.emotionVisualizationEnabled)
      } else if (typeof runtimeGame.emotion_visualization_enabled === 'boolean') {
        setEmotionVisualizationEnabled(runtimeGame.emotion_visualization_enabled)
      } else {
        setEmotionVisualizationEnabled(false)
      }
      setCanonicalStatePipelineEnabled(
        typeof override.canonicalStatePipelineEnabled === 'boolean'
          ? override.canonicalStatePipelineEnabled
          : normalizedRuntimeCanonicalStatePipelineEnabled,
      )
      setCanonicalStateSafeFallbackEnabled(
        typeof override.canonicalStateSafeFallbackEnabled === 'boolean'
          ? override.canonicalStateSafeFallbackEnabled
          : normalizedRuntimeCanonicalStateSafeFallbackEnabled,
      )
      return
    }
    if (typeof runtimeGame.story_llm_model === 'string' && runtimeGame.story_llm_model.trim().length > 0) {
      setStoryLlmModel(normalizedRuntimeStoryModel)
    }
    setMemoryOptimizationEnabled(true)
    setMemoryOptimizationMode(normalizedRuntimeMemoryOptimizationMode)
    if (typeof runtimeGame.story_temperature === 'number') {
      setStoryTemperature(clampStoryTemperature(runtimeGame.story_temperature))
    } else {
      setStoryTemperature(runtimeSamplingDefaults.storyTemperature)
    }
    if (typeof runtimeGame.story_repetition_penalty === 'number') {
      const normalizedRepetitionPenalty = clampStoryRepetitionPenalty(runtimeGame.story_repetition_penalty)
      setStoryRepetitionPenalty(normalizedRepetitionPenalty)
      setStoryRepetitionPenaltyDraft(normalizedRepetitionPenalty.toFixed(2))
    } else {
      setStoryRepetitionPenalty(runtimeSamplingDefaults.storyRepetitionPenalty)
      setStoryRepetitionPenaltyDraft(runtimeSamplingDefaults.storyRepetitionPenalty.toFixed(2))
    }
    if (typeof runtimeGame.story_top_k === 'number') {
      setStoryTopK(clampStoryTopK(runtimeGame.story_top_k))
    } else {
      setStoryTopK(runtimeSamplingDefaults.storyTopK)
    }
    if (typeof runtimeGame.story_top_r === 'number') {
      setStoryTopR(clampStoryTopR(runtimeGame.story_top_r))
    } else {
      setStoryTopR(runtimeSamplingDefaults.storyTopR)
    }
    setShowGgThoughts(false)
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
    if (typeof runtimeGame.character_state_enabled === 'boolean') {
      setCharacterStateEnabled(runtimeGame.character_state_enabled)
    } else {
      setCharacterStateEnabled(false)
    }
    if (typeof runtimeGame.emotion_visualization_enabled === 'boolean') {
      setEmotionVisualizationEnabled(runtimeGame.emotion_visualization_enabled)
    } else {
      setEmotionVisualizationEnabled(false)
    }
    setCanonicalStatePipelineEnabled(normalizedRuntimeCanonicalStatePipelineEnabled)
    setCanonicalStateSafeFallbackEnabled(normalizedRuntimeCanonicalStateSafeFallbackEnabled)
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
  const shouldRenderStandaloneQuickStartIntro = useMemo(() => {
    const normalizedQuickStartIntro = quickStartIntro.replace(/\r\n/g, '\n').trim()
    if (!normalizedQuickStartIntro) {
      return false
    }
    return !messages.some(
      (message) =>
        message.role === 'assistant' && message.content.replace(/\r\n/g, '\n').trim() === normalizedQuickStartIntro,
    )
  }, [messages, quickStartIntro])
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
  useEffect(() => {
    rememberLastPlayedGameCard(activeGameSummary)
  }, [activeGameSummary])
  const storyTurnCount = useMemo(
    () => (activeGameSummary?.turn_count ?? countStoryCompletedTurns(messages)) + (isRerollTurnPendingReplacement ? 1 : 0),
    [activeGameSummary?.turn_count, isRerollTurnPendingReplacement, messages],
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
  const isStoryTurnBusy = isGenerating || isFinalizingStoryTurn
  const canUndoAssistantStep =
    !isStoryTurnBusy &&
    !isUndoingAssistantStep &&
    Boolean(activeGameId) &&
    messages.length > 0
  const canRedoAssistantStep =
    !isStoryTurnBusy &&
    !isUndoingAssistantStep &&
    Boolean(activeGameId) &&
    canRedoAssistantStepServer
  const canReroll =
    !isStoryTurnBusy &&
    !isUndoingAssistantStep &&
    Boolean(activeGameId) &&
    currentRerollSourceUserMessage !== null &&
    currentRerollAssistantMessage !== null
  const canGenerateLatestTurnImage =
    !isStoryTurnBusy &&
    !isUndoingAssistantStep &&
    !isCreatingGame &&
    Boolean(activeGameId) &&
    currentRerollAssistantMessage !== null &&
    !isLatestTurnImageLoading
  const canContinueLatestTurn =
    !isStoryTurnBusy &&
    !isUndoingAssistantStep &&
    !isCreatingGame &&
    currentRerollAssistantMessage !== null &&
    continueHiddenForMessageId !== currentRerollAssistantMessage.id
  const isAdministrator = user.role === 'administrator'
  const canViewDevMemoryTab = isAdministrator
  const isRightPanelSecondTabVisible =
    rightPanelMode === 'world' || (rightPanelMode === 'memory' && canViewDevMemoryTab)
  const leftPanelTabLabel =
    rightPanelMode === 'ai'
      ? 'Настройки'
      : rightPanelMode === 'world'
        ? 'Карточки'
        : 'Память'
  const rightPanelTabLabel =
    rightPanelMode === 'world' ? 'Окружение' : 'Дев Память'
  const isLeftPanelTabActive =
    rightPanelMode === 'ai'
      ? true
      : rightPanelMode === 'world'
        ? activeWorldPanelTab === 'story'
        : activeMemoryPanelTab === 'memory'
  const rightPanelContentKey =
    rightPanelMode === 'ai'
      ? `ai-${activeAiPanelTab}`
      : rightPanelMode === 'world'
        ? `world-${activeWorldPanelTab}`
        : `memory-${activeMemoryPanelTab}`
  const environmentTimeEnabled = Boolean(
    activeGameSummary?.environment_time_enabled ?? activeGameSummary?.environment_enabled,
  )
  const environmentWeatherEnabled = Boolean(
    activeGameSummary?.environment_weather_enabled ?? activeGameSummary?.environment_enabled,
  )
  const environmentCurrentWeather = activeGameSummary?.environment_current_weather ?? null
  const environmentDateInfo = useMemo(
    () => formatEnvironmentDateInfo(activeGameSummary?.environment_current_datetime, environmentCurrentWeather),
    [activeGameSummary?.environment_current_datetime, environmentCurrentWeather],
  )
  const environmentTimeline = useMemo(
    () => normalizeEnvironmentTimeline(environmentCurrentWeather?.timeline),
    [environmentCurrentWeather],
  )
  const activeEnvironmentTimelineIndex = useMemo(
    () => resolveEnvironmentTimelineActiveIndex(activeGameSummary?.environment_current_datetime),
    [activeGameSummary?.environment_current_datetime],
  )
  const activeEnvironmentTimelineEntry = useMemo(
    () => environmentTimeline[activeEnvironmentTimelineIndex] ?? createDefaultEnvironmentTimeline()[activeEnvironmentTimelineIndex] ?? null,
    [activeEnvironmentTimelineIndex, environmentTimeline],
  )

  const openEnvironmentEditor = useCallback(() => {
    const currentWeather = activeGameSummary?.environment_current_weather ?? null
    const currentMonthDraft = resolveEnvironmentMonthDraftValueFromState(
      activeGameSummary?.environment_current_datetime,
      currentWeather,
    )
    const activeTimelineSummary = readEnvironmentString(activeEnvironmentTimelineEntry?.summary)
    setEnvironmentSeasonDraft(
      resolveEnvironmentSeasonDraftValueFromState(activeGameSummary?.environment_current_datetime, currentWeather),
    )
    setEnvironmentMonthDraft(currentMonthDraft)
    setEnvironmentTimeDraft(resolveEnvironmentTimeDraftValue(activeGameSummary?.environment_current_datetime))
    setEnvironmentLocationDraft(readEnvironmentString(activeGameSummary?.current_location_label))
    setEnvironmentCurrentSummaryDraft(readEnvironmentString(currentWeather?.summary) || activeTimelineSummary)
    setEnvironmentEditorOpen(true)
  }, [activeEnvironmentTimelineEntry, activeGameSummary])
  useEffect(() => {
    if (activeAiPanelTab === 'instructions') {
      setActiveAiPanelTab('settings')
    }
  }, [activeAiPanelTab])

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
  const latestLocationMemoryLabel = useMemo(() => {
    const latestBlock = [...aiMemoryBlocks]
      .filter((block) => block.layer === 'location')
      .sort((a, b) => b.id - a.id)[0]
    const contentLabel = readEnvironmentString(latestBlock?.content)
      .replace(/^Действие происходит\s+/i, '')
      .replace(/^События происходят\s+/i, '')
      .replace(/[.]+$/g, '')
      .trim()
    return contentLabel || readEnvironmentString(activeGameSummary?.current_location_label) || 'Место не определено'
  }, [activeGameSummary?.current_location_label, aiMemoryBlocks])
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
          title: toStoryText(card.title).replace(/\s+/g, ' ').trim(),
          content: replaceMainHeroInlineTags(toStoryText(card.content).replace(/\r\n/g, '\n').trim(), resolvedMainHeroName),
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
        title: toStoryText(block.title).replace(/\s+/g, ' ').trim(),
        content: toStoryText(block.content).replace(/\r\n/g, '\n').trim(),
        layer: block.layer,
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
  const assistantBlocksCacheRef = useRef<Map<number, { source: string; blocks: AssistantMessageBlock[] }>>(new Map())
  const assistantBlocksByMessageId = useMemo(() => {
    const cache = assistantBlocksCacheRef.current
    const nextAssistantMessageIds = new Set<number>()
    const blocksByMessageId = new Map<number, AssistantMessageDisplayBlock[]>()

    renderedMessages.forEach((message) => {
      if (message.role !== 'assistant') {
        return
      }

      const resolvedContent = replaceMainHeroInlineTags(message.content, mainHeroDisplayNameForTags)
      const cachedEntry = cache.get(message.id)
      const parsedBlocks =
        cachedEntry?.source === resolvedContent
          ? cachedEntry.blocks
          : parseAssistantMessageBlocks(resolvedContent)

      if (cachedEntry?.source !== resolvedContent) {
        cache.set(message.id, { source: resolvedContent, blocks: parsedBlocks })
      }

      nextAssistantMessageIds.add(message.id)
      blocksByMessageId.set(
        message.id,
        filterAssistantMessageBlocksForDisplay(parsedBlocks, {
          mainHeroName: mainHeroDisplayNameForTags,
          showNpcThoughts,
        }),
      )
    })

    for (const messageId of Array.from(cache.keys())) {
      if (!nextAssistantMessageIds.has(messageId)) {
        cache.delete(messageId)
      }
    }

    return blocksByMessageId
  }, [mainHeroDisplayNameForTags, renderedMessages, showNpcThoughts])
  const normalizedPlotCardsForContext = useMemo(
    () => {
      if (!memoryOptimizationEnabled) {
        return []
      }
      return activePlotCardsForContext
        .map((card) => ({
          title: toStoryText(card.title).replace(/\s+/g, ' ').trim(),
          content: replaceMainHeroInlineTags(toStoryText(card.content).replace(/\r\n/g, '\n').trim(), mainHeroDisplayNameForTags),
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
          title: toStoryText(card.title).replace(/\s+/g, ' ').trim(),
          content: toStoryText(card.content).replace(/\r\n/g, '\n').trim(),
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
        content: toStoryText(message.content).replace(/\r\n/g, '\n').trim(),
      }))
      .filter((message) => message.content.length > 0)
    if (normalizedHistory.length === 0) {
      return 0
    }
    const historyBudgetTokens = Math.max(contextLimitChars - instructionContextTokensUsed - worldContextTokensUsed, 0)
    return estimateHistoryTokensWithinBudget(normalizedHistory, historyBudgetTokens)
  }, [contextLimitChars, instructionContextTokensUsed, messages, worldContextTokensUsed])
  const keyMemoryCardsForContext = useMemo(
    () => normalizedAiMemoryCardsForContext.filter((block) => block.layer === 'key'),
    [normalizedAiMemoryCardsForContext],
  )
  const rawMemoryCardsForContext = useMemo(
    () => normalizedAiMemoryCardsForContext.filter((block) => block.layer === 'raw'),
    [normalizedAiMemoryCardsForContext],
  )
  const compressedMemoryCardsForContext = useMemo(
    () => normalizedAiMemoryCardsForContext.filter((block) => block.layer === 'compressed'),
    [normalizedAiMemoryCardsForContext],
  )
  const superMemoryCardsForContext = useMemo(
    () => normalizedAiMemoryCardsForContext.filter((block) => block.layer === 'super'),
    [normalizedAiMemoryCardsForContext],
  )
  const rawPlotContextTokensUsed = useMemo(
    () => estimateStructuredCardsTokens(normalizedPlotCardsForContext),
    [normalizedPlotCardsForContext],
  )
  const fixedCardsBudgetTokens = useMemo(
    () => Math.max(contextLimitChars - instructionContextTokensUsed - worldContextTokensUsed, 0),
    [contextLimitChars, instructionContextTokensUsed, worldContextTokensUsed],
  )
  const keyMemoryBudgetTokens = useMemo(
    () => Math.min(contextLimitChars, Math.max(Math.floor(contextLimitChars * STORY_KEY_MEMORY_BUDGET_SHARE), STORY_KEY_MEMORY_MIN_BUDGET_TOKENS)),
    [contextLimitChars],
  )
  const effectiveKeyMemoryContextTokensUsed = useMemo(() => {
    if (!memoryOptimizationEnabled || keyMemoryCardsForContext.length === 0) {
      return 0
    }
    return estimatePlotCardsTokensWithinBudget(keyMemoryCardsForContext, Math.min(keyMemoryBudgetTokens, fixedCardsBudgetTokens))
  }, [fixedCardsBudgetTokens, keyMemoryBudgetTokens, keyMemoryCardsForContext, memoryOptimizationEnabled])
  const plotBudgetTokens = useMemo(() => {
    const availableAfterKey = Math.max(fixedCardsBudgetTokens - effectiveKeyMemoryContextTokensUsed, 0)
    return Math.min(Math.floor(contextLimitChars * STORY_PLOT_CONTEXT_MAX_SHARE), availableAfterKey)
  }, [contextLimitChars, effectiveKeyMemoryContextTokensUsed, fixedCardsBudgetTokens])
  const effectivePlotContextTokensUsed = useMemo(() => {
    if (!memoryOptimizationEnabled || normalizedPlotCardsForContext.length === 0) {
      return 0
    }
    return estimatePlotCardsTokensWithinBudget(normalizedPlotCardsForContext, plotBudgetTokens)
  }, [memoryOptimizationEnabled, normalizedPlotCardsForContext, plotBudgetTokens])
  const devMemoryBudgetTokens = useMemo(
    () => Math.max(fixedCardsBudgetTokens - effectiveKeyMemoryContextTokensUsed - effectivePlotContextTokensUsed, 0),
    [effectiveKeyMemoryContextTokensUsed, effectivePlotContextTokensUsed, fixedCardsBudgetTokens],
  )
  const rawMemoryBudgetTokens = useMemo(() => Math.max(Math.floor(devMemoryBudgetTokens * 0.5), 0), [devMemoryBudgetTokens])
  const compressedMemoryBudgetTokens = useMemo(() => Math.max(Math.floor(devMemoryBudgetTokens * 0.3), 0), [devMemoryBudgetTokens])
  const superMemoryBudgetTokens = useMemo(
    () => Math.max(devMemoryBudgetTokens - rawMemoryBudgetTokens - compressedMemoryBudgetTokens, 0),
    [compressedMemoryBudgetTokens, devMemoryBudgetTokens, rawMemoryBudgetTokens],
  )
  const effectiveRawMemoryContextTokensUsed = useMemo(
    () => estimatePlotCardsTokensWithinBudget(rawMemoryCardsForContext, rawMemoryBudgetTokens),
    [rawMemoryBudgetTokens, rawMemoryCardsForContext],
  )
  const effectiveCompressedMemoryContextTokensUsed = useMemo(
    () => estimatePlotCardsTokensWithinBudget(compressedMemoryCardsForContext, compressedMemoryBudgetTokens),
    [compressedMemoryBudgetTokens, compressedMemoryCardsForContext],
  )
  const effectiveSuperMemoryContextTokensUsed = useMemo(
    () => estimatePlotCardsTokensWithinBudget(superMemoryCardsForContext, superMemoryBudgetTokens),
    [superMemoryBudgetTokens, superMemoryCardsForContext],
  )
  const effectiveAiMemoryContextTokensUsed = useMemo(
    () =>
      effectiveKeyMemoryContextTokensUsed +
      effectiveRawMemoryContextTokensUsed +
      effectiveCompressedMemoryContextTokensUsed +
      effectiveSuperMemoryContextTokensUsed,
    [
      effectiveCompressedMemoryContextTokensUsed,
      effectiveKeyMemoryContextTokensUsed,
      effectiveRawMemoryContextTokensUsed,
      effectiveSuperMemoryContextTokensUsed,
    ],
  )
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
  const plotContextOverflowTokens = Math.max(rawPlotContextTokensUsed - plotBudgetTokens, 0)
  const recommendedContextLimitForBudget = useMemo(() => {
    if (plotContextOverflowTokens <= 0) {
      return contextLimitChars
    }
    const plotCapRequirement = Math.ceil(rawPlotContextTokensUsed / STORY_PLOT_CONTEXT_MAX_SHARE)
    const fixedBudgetRequirement =
      instructionContextTokensUsed + worldContextTokensUsed + keyMemoryBudgetTokens + rawPlotContextTokensUsed + 1000
    return clampStoryContextLimit(Math.min(STORY_CONTEXT_LIMIT_MAX, Math.max(plotCapRequirement, fixedBudgetRequirement)))
  }, [
    contextLimitChars,
    instructionContextTokensUsed,
    keyMemoryBudgetTokens,
    plotContextOverflowTokens,
    rawPlotContextTokensUsed,
    worldContextTokensUsed,
  ])
  const currentTurnCostTokens = useMemo(
    () =>
      getStoryTurnCostTokens(
        cardsContextCharsUsed,
        storyLlmModel,
        ambientEnabled,
        isAdministrator && emotionVisualizationEnabled,
      ),
    [ambientEnabled, cardsContextCharsUsed, emotionVisualizationEnabled, isAdministrator, storyLlmModel],
  )
  const hasInsufficientTokensForTurn = user.coins < currentTurnCostTokens
  useEffect(() => {
    if (!pendingContextBudgetCheckRef.current || isGenerating) {
      return
    }
    pendingContextBudgetCheckRef.current = false
    if (plotContextOverflowTokens <= 0 || recommendedContextLimitForBudget <= contextLimitChars) {
      return
    }
    setContextBudgetWarning({
      recommendedLimit: recommendedContextLimitForBudget,
      plotOverflowTokens: plotContextOverflowTokens,
    })
  }, [contextLimitChars, isGenerating, plotContextOverflowTokens, recommendedContextLimitForBudget])
  const isSavingThoughtVisibility = isSavingShowGgThoughts || isSavingShowNpcThoughts
  const inputPlaceholder = hasInsufficientTokensForTurn
    ? OUT_OF_TOKENS_INPUT_PLACEHOLDER
    : hasMessages
      ? NEXT_INPUT_PLACEHOLDER
      : INITIAL_INPUT_PLACEHOLDER
  const speechRecognitionCtor = useMemo(() => resolveSpeechRecognitionCtor(), [])
  const voiceInputSupported = speechRecognitionCtor !== null
  const hasPromptText = inputValue.trim().length > 0
  const showMicAction = voiceInputEnabled && !isStoryTurnBusy && (!hasPromptText || isVoiceInputActive)
  const canUseVoiceInput =
    voiceInputEnabled &&
    !isStoryTurnBusy &&
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
    isSavingAmbientEnabled ||
    isSavingCharacterStateEnabled ||
    isSavingEmotionVisualizationEnabled ||
    isSavingCanonicalStatePipeline ||
    isSavingCanonicalStateSafeFallback
  const isInstructionCardActionLocked =
    isStoryTurnBusy || isSavingInstruction || isCreatingGame || deletingInstructionId !== null || updatingInstructionActiveId !== null
  const isWorldCardActionLocked = isStoryTurnBusy || isSavingWorldCard || isCreatingGame || deletingWorldCardId !== null
  const isMemoryCardActionLocked = isStoryTurnBusy || isSavingMemoryBlock || isCreatingGame || deletingMemoryBlockId !== null
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
  useEffect(() => {
    let isMounted = true
    void getOnboardingGuideState(authToken)
      .then((state) => {
        if (isMounted) {
          setTutorialGameId(state.tutorial_game_id ?? null)
        }
      })
      .catch(() => {
        if (isMounted) {
          setTutorialGameId(null)
        }
      })
    return () => {
      isMounted = false
    }
  }, [authToken])
  useEffect(() => {
    if (!activeGameId) {
      missingMainHeroPromptedGameIdRef.current = null
      setMissingMainHeroDialogOpen(false)
      return
    }
    if (mainHeroCard) {
      setMissingMainHeroDialogOpen(false)
      return
    }
    if (isBootstrappingGameData || isLoadingGameMessages) {
      return
    }
    if (tutorialGameId !== null && activeGameId === tutorialGameId) {
      return
    }
    if (localStorage.getItem(MISSING_MAIN_HERO_DIALOG_SUPPRESS_KEY) === '1') {
      return
    }
    if (missingMainHeroPromptedGameIdRef.current === activeGameId) {
      return
    }
    missingMainHeroPromptedGameIdRef.current = activeGameId
    setMissingMainHeroDialogOpen(true)
  }, [activeGameId, isBootstrappingGameData, isLoadingGameMessages, mainHeroCard, tutorialGameId])
  const displayedWorldCards = useMemo(
    () => worldCards.filter((card) => card.kind !== 'main_hero'),
    [worldCards],
  )
  const worldProfileCard = useMemo(
    () => worldCards.find((card) => card.kind === 'world_profile') ?? null,
    [worldCards],
  )
  const displayedNpcCards = useMemo(
    () =>
      [...displayedWorldCards.filter((card) => card.kind === 'npc')].sort((left, right) => {
        const leftActive = Boolean(worldCardContextStateById.get(left.id)?.isActive)
        const rightActive = Boolean(worldCardContextStateById.get(right.id)?.isActive)
        if (leftActive !== rightActive) {
          return leftActive ? -1 : 1
        }
        return parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
      }),
    [displayedWorldCards, worldCardContextStateById],
  )
  const displayedDetailCards = useMemo(
    () =>
      [...displayedWorldCards.filter((card) => card.kind === 'world')].sort((left, right) => {
        const leftActive = Boolean(worldCardContextStateById.get(left.id)?.isActive)
        const rightActive = Boolean(worldCardContextStateById.get(right.id)?.isActive)
        if (leftActive !== rightActive) {
          return leftActive ? -1 : 1
        }
        return parseSortDate(right.updated_at) - parseSortDate(left.updated_at) || right.id - left.id
      }),
    [displayedWorldCards, worldCardContextStateById],
  )
  const worldDetailTypeSuggestionLabels = useMemo(
    () => buildStoryWorldDetailTypeSuggestions(worldDetailTypeOptions, [worldCardDetailTypeDraft]),
    [worldCardDetailTypeDraft, worldDetailTypeOptions],
  )
  const normalizedWorldCardDetailTypeDraft = useMemo(
    () => normalizeStoryWorldDetailTypeValue(worldCardDetailTypeDraft),
    [worldCardDetailTypeDraft],
  )
  const worldDetailTypeAutocompleteOptions = useMemo<WorldDetailTypeAutocompleteOption[]>(
    () => worldDetailTypeSuggestionLabels.map((label) => ({ label, value: label })),
    [worldDetailTypeSuggestionLabels],
  )
  const handleCardsPanelTabSelect = useCallback((nextTab: CardsPanelTab) => {
    if (cardsPanelTabsDragStateRef.current.suppressClick) {
      cardsPanelTabsDragStateRef.current.suppressClick = false
      return
    }
    setCardsPanelTab(nextTab)
  }, [])
  const handleCardsPanelTabsPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }
    const currentTarget = event.currentTarget
    cardsPanelTabsDragStateRef.current.pointerId = event.pointerId
    cardsPanelTabsDragStateRef.current.startX = event.clientX
    cardsPanelTabsDragStateRef.current.startY = event.clientY
    cardsPanelTabsDragStateRef.current.scrollLeft = currentTarget.scrollLeft
    cardsPanelTabsDragStateRef.current.isDragging = false
    cardsPanelTabsDragStateRef.current.suppressClick = false
  }, [])
  const handleCardsPanelTabsPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (cardsPanelTabsDragStateRef.current.pointerId !== event.pointerId) {
      return
    }
    const deltaX = event.clientX - cardsPanelTabsDragStateRef.current.startX
    const deltaY = event.clientY - cardsPanelTabsDragStateRef.current.startY
    const hasEnoughHorizontalTravel = Math.abs(deltaX) >= CARDS_PANEL_TABS_DRAG_THRESHOLD_PX
    const isHorizontalIntent = Math.abs(deltaX) > Math.abs(deltaY) * 1.1

    if (!cardsPanelTabsDragStateRef.current.isDragging) {
      if (!hasEnoughHorizontalTravel || !isHorizontalIntent) {
        return
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      cardsPanelTabsDragStateRef.current.isDragging = true
    }
    event.currentTarget.scrollLeft = cardsPanelTabsDragStateRef.current.scrollLeft - deltaX
    cardsPanelTabsDragStateRef.current.suppressClick = true
    event.preventDefault()
  }, [])
  const handleCardsPanelTabsPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (cardsPanelTabsDragStateRef.current.pointerId !== event.pointerId) {
      return
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    cardsPanelTabsDragStateRef.current.pointerId = null
    cardsPanelTabsDragStateRef.current.isDragging = false
    if (cardsPanelTabsDragStateRef.current.suppressClick) {
      window.setTimeout(() => {
        cardsPanelTabsDragStateRef.current.suppressClick = false
      }, 0)
    }
  }, [])
  const handleOpenWorldCardTemplatePicker = useCallback((kind: 'world' | 'world_profile') => {
    if (isWorldCardActionLocked) {
      return
    }
    setWorldCardTemplatePickerKind(kind)
    setWorldCardTemplatePickerOpen(true)
  }, [isWorldCardActionLocked])
  const resolveDirectWorldCardAvatar = useCallback(
    (card: StoryWorldCard | null): string | null => {
      if (!card) {
        return null
      }
      return card.avatar_url
    },
    [],
  )
  const resolveDirectWorldCardPreviewAvatar = useCallback(
    (card: StoryWorldCard | null): string | null => {
      if (!card) {
        return null
      }
      return card.avatar_original_url ?? card.avatar_url
    },
    [],
  )
  const editingWorldCard = useMemo(
    () => (editingWorldCardId !== null ? worldCards.find((card) => card.id === editingWorldCardId) ?? null : null),
    [editingWorldCardId, worldCards],
  )
  const isCharacterWorldCardEditor =
    worldCardDialogOpen && (editingWorldCardKind === 'main_hero' || editingWorldCardKind === 'npc')
  const shouldShowCharacterManagerNpcMemoryEditor =
    characterManagerDialogOpen && characterManagerSyncCardId !== null && characterManagerSyncCardKind === 'npc'
  const normalizedWorldCardRaceDraft = useMemo(
    () => normalizeCharacterRaceValue(worldCardRaceDraft),
    [worldCardRaceDraft],
  )
  const normalizedWorldCardRaceInputDraft = useMemo(
    () => normalizeCharacterRaceValue(worldCardRaceInputDraft),
    [worldCardRaceInputDraft],
  )
  const worldCardRaceOptions = useMemo(() => {
    const seen = new Set<string>()
    const items: CharacterRaceOption[] = []
    const pushOption = (rawValue: string) => {
      const normalizedValue = normalizeCharacterRaceValue(rawValue)
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
    pushOption(worldCardRaceDraft)
    return items
  }, [characterRaceOptions, worldCardRaceDraft])
  const selectedWorldCardRaceOption = useMemo(
    () => worldCardRaceOptions.find((option) => option.value === normalizedWorldCardRaceDraft) ?? null,
    [normalizedWorldCardRaceDraft, worldCardRaceOptions],
  )
  const selectedWorldCardDetailTypeOption = useMemo(() => {
    if (!normalizedWorldCardDetailTypeDraft) {
      return null
    }
    return (
      worldDetailTypeAutocompleteOptions.find(
        (option) => option.value.toLocaleLowerCase() === normalizedWorldCardDetailTypeDraft.toLocaleLowerCase(),
      ) ?? {
        label: normalizedWorldCardDetailTypeDraft,
        value: normalizedWorldCardDetailTypeDraft,
      }
    )
  }, [normalizedWorldCardDetailTypeDraft, worldDetailTypeAutocompleteOptions])
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
  const resolveLinkedCharacterForWorldCard = useCallback(
    (card: StoryWorldCard | null): StoryCharacter | null => {
      if (!card) {
        return null
      }
      return card.character_id && card.character_id > 0 ? charactersById.get(card.character_id) ?? null : null
    },
    [charactersById],
  )
  const resolveLinkedCharacterPreviewAvatar = useCallback(
    (card: StoryWorldCard | null): string | null => {
      const linkedCharacter = resolveLinkedCharacterForWorldCard(card)
      return linkedCharacter?.avatar_original_url ?? linkedCharacter?.avatar_url ?? null
    },
    [resolveLinkedCharacterForWorldCard],
  )
  const resolveWorldCardAvatar = useCallback(
    (card: StoryWorldCard | null): string | null => {
      const directAvatar = resolveDirectWorldCardAvatar(card)
      if (directAvatar) {
        return directAvatar
      }
      const linkedCharacter = resolveLinkedCharacterForWorldCard(card)
      return linkedCharacter?.avatar_url ?? linkedCharacter?.avatar_original_url ?? null
    },
    [resolveDirectWorldCardAvatar, resolveLinkedCharacterForWorldCard],
  )
  const resolveWorldCardPreviewAvatar = useCallback(
    (card: StoryWorldCard | null): string | null => {
      const directPreviewAvatar = resolveDirectWorldCardPreviewAvatar(card)
      if (directPreviewAvatar) {
        return directPreviewAvatar
      }
      return resolveLinkedCharacterPreviewAvatar(card)
    },
    [resolveDirectWorldCardPreviewAvatar, resolveLinkedCharacterPreviewAvatar],
  )
  const mainHeroAvatarUrl = useMemo(() => resolveWorldCardAvatar(mainHeroCard), [mainHeroCard, resolveWorldCardAvatar])
  const editingWorldCardAvatarUrl = useMemo(
    () => worldCardAvatarDraft ?? resolveWorldCardAvatar(editingWorldCard),
    [editingWorldCard, resolveWorldCardAvatar, worldCardAvatarDraft],
  )
  const editingWorldCardPreviewAvatarUrl = useMemo(
    () => worldCardAvatarOriginalDraft ?? worldCardAvatarDraft ?? resolveWorldCardPreviewAvatar(editingWorldCard),
    [editingWorldCard, resolveWorldCardPreviewAvatar, worldCardAvatarDraft, worldCardAvatarOriginalDraft],
  )
  const hasWorldCardDialogUnsavedChanges = useMemo(() => {
    if (!worldCardDialogOpen) {
      return false
    }

    if (!editingWorldCard) {
      const emptyMemoryTurns = editingWorldCardKind === 'npc' ? NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS : WORLD_CARD_TRIGGER_ACTIVE_TURNS
      return (
        Boolean(worldCardTitleDraft.trim()) ||
        Boolean(worldCardContentDraft.trim()) ||
        Boolean(worldCardDetailTypeDraft.trim()) ||
        Boolean(worldCardRaceDraft.trim()) ||
        Boolean(worldCardRaceInputDraft.trim()) ||
        Boolean(worldCardClothingDraft.trim()) ||
        Boolean(worldCardInventoryDraft.trim()) ||
        Boolean(worldCardHealthStatusDraft.trim()) ||
        Boolean(worldCardTriggersDraft.trim()) ||
        worldCardMemoryTurnsDraft !== emptyMemoryTurns ||
        Boolean(worldCardAvatarDraft) ||
        Boolean(worldCardAvatarOriginalDraft) ||
        worldCardAvatarScaleDraft !== 1 ||
        isWorldCardAvatarDraftDirty
      )
    }

    const originalAvatar = resolveWorldCardAvatar(editingWorldCard)
    const originalPreviewAvatar = resolveWorldCardPreviewAvatar(editingWorldCard) ?? originalAvatar

    return (
      worldCardTitleDraft !== editingWorldCard.title ||
      worldCardContentDraft !== editingWorldCard.content ||
      worldCardDetailTypeDraft !== normalizeStoryWorldDetailTypeValue(editingWorldCard.detail_type) ||
      worldCardRaceDraft !== normalizeCharacterRaceValue(editingWorldCard.race) ||
      worldCardRaceInputDraft !== normalizeCharacterRaceValue(editingWorldCard.race) ||
      worldCardClothingDraft !== normalizeCharacterAdditionalValue(editingWorldCard.clothing) ||
      worldCardInventoryDraft !== normalizeCharacterAdditionalValue(editingWorldCard.inventory) ||
      worldCardHealthStatusDraft !== normalizeCharacterAdditionalValue(editingWorldCard.health_status) ||
      worldCardTriggersDraft !== editingWorldCard.triggers.join(', ') ||
      worldCardMemoryTurnsDraft !== toNpcMemoryTurnsOption(resolveWorldCardMemoryTurns(editingWorldCard)) ||
      worldCardAvatarDraft !== originalAvatar ||
      worldCardAvatarOriginalDraft !== originalPreviewAvatar ||
      worldCardAvatarScaleDraft !== (editingWorldCard.avatar_scale ?? 1) ||
      isWorldCardAvatarDraftDirty
    )
  }, [
    editingWorldCard,
    editingWorldCardKind,
    isWorldCardAvatarDraftDirty,
    resolveWorldCardAvatar,
    resolveWorldCardPreviewAvatar,
    worldCardAvatarDraft,
    worldCardAvatarOriginalDraft,
    worldCardAvatarScaleDraft,
    worldCardClothingDraft,
    worldCardContentDraft,
    worldCardDetailTypeDraft,
    worldCardDialogOpen,
    worldCardHealthStatusDraft,
    worldCardInventoryDraft,
    worldCardMemoryTurnsDraft,
    worldCardRaceDraft,
    worldCardRaceInputDraft,
    worldCardTitleDraft,
    worldCardTriggersDraft,
  ])
  const mainHeroPreviewAvatarUrl = useMemo(
    () => resolveWorldCardPreviewAvatar(mainHeroCard),
    [mainHeroCard, resolveWorldCardPreviewAvatar],
  )
  const mainHeroSourceCharacterId = useMemo(() => {
    const linkedCharacter = resolveLinkedCharacterForWorldCard(mainHeroCard)
    if (!linkedCharacter?.source_character_id || linkedCharacter.source_character_id <= 0) {
      return null
    }
    return linkedCharacter.source_character_id
  }, [mainHeroCard, resolveLinkedCharacterForWorldCard])
  const npcSourceCharacterIds = useMemo(() => {
    const selectedIds = new Set<number>()
    worldCards.forEach((card) => {
      if (card.kind !== 'npc') {
        return
      }
      const linkedCharacter = resolveLinkedCharacterForWorldCard(card)
      if (!linkedCharacter?.source_character_id || linkedCharacter.source_character_id <= 0) {
        return
      }
      selectedIds.add(linkedCharacter.source_character_id)
    })
    return selectedIds
  }, [resolveLinkedCharacterForWorldCard, worldCards])
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
        character.race,
        character.description,
        character.clothing,
        character.inventory,
        character.health_status,
        character.note,
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
          item.race,
          item.description,
          item.clothing,
          item.inventory,
          item.health_status,
          item.note,
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

      const linkedCharacter = resolveLinkedCharacterForWorldCard(card)
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
  }, [characters, resolveLinkedCharacterForWorldCard, resolveWorldCardAvatar, resolveWorldCardPreviewAvatar, worldCards])
  const sceneEmotionEntries = useMemo(() => {
    const entries: SceneEmotionCharacterEntry[] = []

    const appendEntry = (
      names: string[],
      displayName: string,
      emotionAssets: StoryCharacterEmotionAssets,
      isMainHero: boolean,
    ) => {
      const normalizedNames = [...new Set(names.filter(Boolean))]
      if (normalizedNames.length === 0) {
        return
      }
      entries.push({
        names: normalizedNames,
        displayName: displayName.trim() || normalizedNames[0],
        emotionAssets: normalizeStoryCharacterEmotionAssets(emotionAssets),
        isMainHero,
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
        STORY_STAGE_MAIN_HERO_LOOKUP_ALIASES.forEach((alias) => {
          const normalizedAlias = normalizeCharacterIdentity(alias)
          if (normalizedAlias) {
            aliasSet.add(normalizedAlias)
          }
        })
      }

      const linkedCharacter = resolveLinkedCharacterForWorldCard(card)
      if (linkedCharacter) {
        buildCharacterAliases(linkedCharacter.name).forEach((alias) => aliasSet.add(alias))
      }

      appendEntry(
        [...aliasSet],
        linkedCharacter?.name ?? card.title,
        linkedCharacter?.emotion_assets ?? {},
        card.kind === 'main_hero',
      )
    })

    return entries
  }, [resolveLinkedCharacterForWorldCard, worldCards])
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
  const findSpeakerEntryByTextContext = useCallback(
    (textFragments: string[]): SpeakerAvatarEntry | null => {
      const searchSpace = normalizeCharacterIdentity(textFragments.filter(Boolean).join(' '))
      if (!searchSpace) {
        return null
      }

      let bestEntry: SpeakerAvatarEntry | null = null
      let bestScore = 0
      let ambiguous = false
      for (const entry of speakerCardsForAvatar) {
        const normalizedDisplayName = normalizeCharacterIdentity(entry.displayName)
        let entryScore = 0
        if (normalizedDisplayName && searchSpace.includes(normalizedDisplayName)) {
          entryScore = 120
        }

        entry.names.forEach((name) => {
          const normalizedName = normalizeCharacterIdentity(name)
          if (!normalizedName) {
            return
          }
          if (!normalizedName.includes(' ') && normalizedName.length < 4) {
            return
          }
          if (!searchSpace.includes(normalizedName)) {
            return
          }
          entryScore = Math.max(entryScore, normalizedName === normalizedDisplayName ? 110 : 100)
        })

        if (entryScore <= 0) {
          continue
        }
        if (entryScore > bestScore) {
          bestEntry = entry
          bestScore = entryScore
          ambiguous = false
          continue
        }
        if (entryScore === bestScore && bestEntry) {
          const bestDisplayName = normalizeCharacterIdentity(bestEntry.displayName)
          if (bestDisplayName !== normalizedDisplayName) {
            ambiguous = true
          }
        }
      }

      return bestScore > 0 && !ambiguous ? bestEntry : null
    },
    [speakerCardsForAvatar],
  )
  const findSceneEmotionEntryByName = useCallback(
    (rawSpeakerName: string): SceneEmotionCharacterEntry | null => {
      const lookupValues = extractSpeakerLookupValues(rawSpeakerName)
      for (const lookupValue of lookupValues) {
        const normalizedName = normalizeCharacterIdentity(lookupValue)
        if (!normalizedName) {
          continue
        }

        const exact = sceneEmotionEntries.find((entry) => entry.names.some((name) => name === normalizedName))
        if (exact) {
          return exact
        }
      }

      return null
    },
    [sceneEmotionEntries],
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
    (speakerName: string, dialogueText: string, nearbyNarrativeText = ''): string => {
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

      if (normalizedSpeaker && genericDialogueSpeakerNames.has(normalizedSpeaker)) {
        const contextualEntry = findSpeakerEntryByTextContext([
          speakerDisplayName,
          dialogueText,
          nearbyNarrativeText,
        ])
        if (contextualEntry) {
          return contextualEntry.displayName
        }
      }

      if (normalizedSpeaker && !genericDialogueSpeakerNames.has(normalizedSpeaker)) {
        return speakerDisplayName || speakerName
      }

      return speakerDisplayName || speakerName
    },
    [findSpeakerEntryByName, findSpeakerEntryByTextContext, genericDialogueSpeakerNames],
  )
  const currentSceneEmotionCue = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role !== 'assistant') {
        continue
      }
      return parseStorySceneEmotionPayload(message.scene_emotion_payload)
    }
    return null
  }, [messages])
  const buildVisualStageParticipantsFromCue = useCallback((cue: StorySceneEmotionCue | null): VisualStageParticipant[] => {
    if (!cue?.show_visualization) {
      return []
    }

    const resolvedParticipants: VisualStageParticipant[] = []
    cue.participants.forEach((participant) => {
      const matchedCharacter = findSceneEmotionEntryByName(participant.name)
      const assetUrl = matchedCharacter?.emotionAssets?.[participant.emotion] ?? ''
      if (!matchedCharacter || !assetUrl.trim()) {
        return
      }
      resolvedParticipants.push({
        ...participant,
        assetUrl,
        displayName: matchedCharacter.displayName,
        isMainHero: matchedCharacter.isMainHero,
      })
    })

    return resolvedParticipants
      .sort((left, right) => {
        if (left.isMainHero !== right.isMainHero) {
          return left.isMainHero ? -1 : 1
        }
        if (left.importance !== right.importance) {
          return left.importance === 'primary' ? -1 : 1
        }
        return 0
      })
      .slice(0, 4)
  }, [findSceneEmotionEntryByName])
  const serverVisualStageParticipants = useMemo(
    () => buildVisualStageParticipantsFromCue(currentSceneEmotionCue),
    [buildVisualStageParticipantsFromCue, currentSceneEmotionCue],
  )
  const currentVisualStageParticipants = useMemo(
    () => serverVisualStageParticipants.filter((participant) => participant.assetUrl.trim().length > 0),
    [serverVisualStageParticipants],
  )
  const currentVisualStageHeroParticipant = useMemo(
    () => currentVisualStageParticipants.find((participant) => participant.isMainHero) ?? null,
    [currentVisualStageParticipants],
  )
  const currentVisualStageNpcParticipants = useMemo(
    () => currentVisualStageParticipants.filter((participant) => !participant.isMainHero).slice(0, 4),
    [currentVisualStageParticipants],
  )
  const currentVisualStageNpcSlots = useMemo(() => {
    const npcCount = currentVisualStageNpcParticipants.length
    if (npcCount <= 1) {
      return [
        {
          rightXs: '1%',
          rightMd: '2%',
          widthXs: '82%',
          widthMd: '80%',
          scaleXs: 1.2,
          scaleMd: 1.32,
          liftXs: 12,
          liftMd: 14,
          zIndex: 4,
          opacity: 1,
        },
      ]
    }
    if (npcCount === 2) {
      return [
        {
          rightXs: '21%',
          rightMd: '24%',
          widthXs: '56%',
          widthMd: '54%',
          scaleXs: 1.12,
          scaleMd: 1.22,
          liftXs: 11,
          liftMd: 13,
          zIndex: 4,
          opacity: 1,
        },
        {
          rightXs: '0%',
          rightMd: '2%',
          widthXs: '45%',
          widthMd: '43%',
          scaleXs: 1,
          scaleMd: 1.08,
          liftXs: 14,
          liftMd: 16,
          zIndex: 3,
          opacity: 0.96,
        },
      ]
    }
    if (npcCount === 3) {
      return [
        {
          rightXs: '27%',
          rightMd: '29%',
          widthXs: '46%',
          widthMd: '44%',
          scaleXs: 1.08,
          scaleMd: 1.18,
          liftXs: 11,
          liftMd: 13,
          zIndex: 5,
          opacity: 1,
        },
        {
          rightXs: '11%',
          rightMd: '13%',
          widthXs: '37%',
          widthMd: '35%',
          scaleXs: 0.98,
          scaleMd: 1.06,
          liftXs: 14,
          liftMd: 16,
          zIndex: 4,
          opacity: 0.95,
        },
        {
          rightXs: '0%',
          rightMd: '1%',
          widthXs: '30%',
          widthMd: '29%',
          scaleXs: 0.9,
          scaleMd: 0.98,
          liftXs: 17,
          liftMd: 18,
          zIndex: 3,
          opacity: 0.9,
        },
      ]
    }
    return [
      {
        rightXs: '31%',
        rightMd: '33%',
        widthXs: '39%',
        widthMd: '37%',
        scaleXs: 1.04,
        scaleMd: 1.14,
        liftXs: 11,
        liftMd: 13,
        zIndex: 6,
        opacity: 1,
      },
      {
        rightXs: '18%',
        rightMd: '20%',
        widthXs: '31%',
        widthMd: '30%',
        scaleXs: 0.94,
        scaleMd: 1.02,
        liftXs: 14,
        liftMd: 16,
        zIndex: 5,
        opacity: 0.95,
      },
      {
        rightXs: '7%',
        rightMd: '8%',
        widthXs: '25%',
        widthMd: '24%',
        scaleXs: 0.86,
        scaleMd: 0.94,
        liftXs: 17,
        liftMd: 19,
        zIndex: 4,
        opacity: 0.9,
      },
      {
        rightXs: '0%',
        rightMd: '1%',
        widthXs: '21%',
        widthMd: '20%',
        scaleXs: 0.8,
        scaleMd: 0.88,
        liftXs: 20,
        liftMd: 21,
        zIndex: 3,
        opacity: 0.84,
      },
    ]
  }, [currentVisualStageNpcParticipants.length])
  const shouldShowEmotionStagePanel =
    isAdministrator &&
    emotionVisualizationEnabled &&
    !shouldShowStoryMessagesLoadingSkeleton &&
    !isLoadingGameMessages
  const shouldShowEmotionStage =
    shouldShowEmotionStagePanel &&
    Boolean(currentSceneEmotionCue?.show_visualization) &&
    (Boolean(currentVisualStageHeroParticipant) || currentVisualStageNpcParticipants.length > 0)
  const currentEmotionStageHeight = emotionStageHeightPx ?? getEmotionStageHeightBounds().defaultHeight
  useEffect(() => {
    if (!shouldShowEmotionStagePanel) {
      setEmotionStageHeightPx(null)
      return
    }

    const syncHeight = () => {
      const { defaultHeight } = getEmotionStageHeightBounds()
      setEmotionStageHeightPx((currentHeight) =>
        currentHeight === null ? defaultHeight : clampEmotionStageHeight(currentHeight),
      )
    }

    syncHeight()
    window.addEventListener('resize', syncHeight)
    return () => {
      window.removeEventListener('resize', syncHeight)
    }
  }, [clampEmotionStageHeight, getEmotionStageHeightBounds, shouldShowEmotionStagePanel])
  const handleStartEmotionStageResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType !== 'touch' && event.pointerType !== 'pen') {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    emotionStageResizingRef.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const updateHeight = (clientY: number) => {
      const panelTop = emotionStagePanelRef.current?.getBoundingClientRect().top
      if (typeof panelTop !== 'number') {
        return
      }
      setEmotionStageHeightPx(clampEmotionStageHeight(clientY - panelTop))
    }

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      updateHeight(pointerEvent.clientY)
    }

    const stopResizing = () => {
      emotionStageResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)
  }, [clampEmotionStageHeight])
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
  const selectedMenuInstructionCard = useMemo(
    () =>
      cardMenuType === 'instruction' && cardMenuCardId !== null
        ? instructionCards.find((card) => card.id === cardMenuCardId) ?? null
        : null,
    [cardMenuCardId, cardMenuType, instructionCards],
  )
  const selectedMenuPlotCard = useMemo(
    () => (cardMenuType === 'plot' && cardMenuCardId !== null ? plotCards.find((card) => card.id === cardMenuCardId) ?? null : null),
    [cardMenuCardId, cardMenuType, plotCards],
  )
  const isSelectedMenuPlotCardTriggerDriven = Boolean(
    selectedMenuPlotCard && plotCardUsesTriggerMode(selectedMenuPlotCard),
  )
  const openedAiMemoryBlock = useMemo(
    () => (openedAiMemoryBlockId !== null ? aiMemoryBlocks.find((block) => block.id === openedAiMemoryBlockId) ?? null : null),
    [aiMemoryBlocks, openedAiMemoryBlockId],
  )
  const isSelectedMenuWorldCardLocked = Boolean(
    selectedMenuWorldCard && selectedMenuWorldCard.is_locked,
  )
  const isSelectedMenuInstructionActiveUpdating = Boolean(
    selectedMenuInstructionCard && updatingInstructionActiveId === selectedMenuInstructionCard.id,
  )
  const isPlotCardActionLocked = isStoryTurnBusy || isSavingPlotCard || isCreatingGame || deletingPlotCardId !== null
  const isSelectedMenuWorldCardAiEditUpdating = Boolean(
    selectedMenuWorldCard && updatingWorldCardAiEditId === selectedMenuWorldCard.id,
  )
  const canDeleteSelectedMenuWorldCard = Boolean(
    selectedMenuWorldCard && selectedMenuWorldCard.kind !== 'main_hero',
  )
  const getWorldCardAiEditStatusLabel = useCallback(
    (card: StoryWorldCard): string =>
      card.ai_edit_enabled ? 'Авто состояние: доступно' : 'Авто состояние: запрещено',
    [],
  )
  const getWorldCardAiEditActionLabel = useCallback(
    (card: StoryWorldCard): string =>
      card.ai_edit_enabled ? 'Авто состояние: запрещено' : 'Авто состояние: доступно',
    [],
  )

  const adjustInputHeight = useCallback(() => {
    const node = textAreaRef.current
    if (!node) {
      return
    }

    node.style.height = 'auto'
    const computedStyle = window.getComputedStyle(node)
    const lineHeight = Number.parseFloat(computedStyle.lineHeight)
    const paddingTop = Number.parseFloat(computedStyle.paddingTop)
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom)
    const computedSingleLineHeight = Math.ceil(
      (Number.isFinite(lineHeight) ? lineHeight : 0)
      + (Number.isFinite(paddingTop) ? paddingTop : 0)
      + (Number.isFinite(paddingBottom) ? paddingBottom : 0),
    )
    const minHeight = Math.max(COMPOSER_INPUT_MIN_HEIGHT, computedSingleLineHeight)
    const nextHeight = Math.min(Math.max(node.scrollHeight, minHeight), COMPOSER_INPUT_MAX_HEIGHT)
    node.style.height = `${nextHeight}px`
    node.style.overflowY = node.scrollHeight > COMPOSER_INPUT_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [])

  const applyUpdatedGameSummary = useCallback((updatedGame: StoryGameSummary) => {
    setActiveGameSummary(updatedGame)
    setGames((previousGames) =>
      sortGamesByActivity(previousGames.map((game) => (game.id === updatedGame.id ? updatedGame : game))),
    )
    setCustomTitleMap((previousMap) => {
      const nextMap = setStoryTitle(previousMap, updatedGame.id, updatedGame.title)
      persistStoryTitleMap(nextMap)
      return nextMap
    })
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

  const loadCharacterRaces = useCallback(async () => {
    setIsLoadingCharacterRaces(true)
    try {
      const loadedRaces = await listStoryCharacterRaces({ token: authToken })
      setCharacterRaceOptions(loadedRaces)
      setHasLoadedCharacterRaces(true)
    } catch (error) {
      const detail = error instanceof Error ? error.message : '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0440\u0430\u0441\u044b \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u0436\u0435\u0439'
      setErrorMessage(detail)
      setCharacterRaceOptions([])
      setHasLoadedCharacterRaces(true)
    } finally {
      setIsLoadingCharacterRaces(false)
    }
  }, [authToken])

  const loadWorldDetailTypes = useCallback(async () => {
    setIsLoadingWorldDetailTypes(true)
    try {
      const loadedTypes = await listStoryWorldDetailTypes({ token: authToken })
      setWorldDetailTypeOptions(loadedTypes)
      setHasLoadedWorldDetailTypes(true)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить типы деталей мира'
      setErrorMessage(detail)
      setWorldDetailTypeOptions([])
      setHasLoadedWorldDetailTypes(true)
    } finally {
      setIsLoadingWorldDetailTypes(false)
    }
  }, [authToken])

  useEffect(() => {
    setCharacterRaceOptions([])
    setHasLoadedCharacterRaces(false)
    setIsLoadingCharacterRaces(false)
    setIsSavingCharacterRace(false)
    setWorldDetailTypeOptions([])
    setHasLoadedWorldDetailTypes(false)
    setIsLoadingWorldDetailTypes(false)
  }, [authToken])

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
    (options?: {
      initialCharacterId?: number | null
      syncCardId?: number | null
      syncCardKind?: StoryWorldCardKind | null
      memoryTurns?: NpcMemoryTurnsOption
    }) => {
      const initialCharacterId = options?.initialCharacterId ?? null
      const syncCardId = options?.syncCardId ?? null
      const syncCardKind = options?.syncCardKind ?? null
      const memoryTurns = options?.memoryTurns ?? NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS
      setCharacterManagerInitialMode('list')
      setCharacterManagerInitialCharacterId(initialCharacterId)
      setCharacterManagerSyncCardId(syncCardId)
      setCharacterManagerSyncCardKind(syncCardKind)
      setCharacterManagerSyncCardMemoryTurnsDraft(memoryTurns)
      setCharacterManagerDialogOpen(true)
    },
    [],
  )

  const handleCloseCharacterManager = useCallback(() => {
    const targetGameId = activeGameId
    const targetCharacterId = characterManagerInitialCharacterId
    const targetCardId = characterManagerSyncCardId
    const targetCardKind = characterManagerSyncCardKind
    const targetMemoryTurns =
      characterManagerSyncCardKind === 'npc' ? characterManagerSyncCardMemoryTurnsDraft : undefined
    const returnMode = characterDialogReturnMode
    let latestCharacters = characters

    setCharacterManagerDialogOpen(false)
    setCharacterManagerInitialMode('list')
    setCharacterManagerInitialCharacterId(null)
    setCharacterManagerSyncCardId(null)
    setCharacterManagerSyncCardKind(null)
    setCharacterManagerSyncCardMemoryTurnsDraft(NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS)
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
        const preparedLinkedAvatarPayload = await prepareAvatarPayloadForRequest({
          avatarUrl: linkedCharacter.avatar_url,
          avatarOriginalUrl: linkedCharacter.avatar_original_url ?? linkedCharacter.avatar_url,
          maxBytes: CHARACTER_AVATAR_MAX_BYTES,
          maxDimension: 960,
        })
        const syncedCard = await updateStoryWorldCard({
          token: authToken,
          gameId: targetGameId,
          cardId: linkedWorldCard.id,
          title: linkedCharacter.name,
          content: linkedCharacter.description,
          race: normalizeCharacterRaceValue(linkedCharacter.race),
          clothing: normalizeCharacterAdditionalValue(linkedCharacter.clothing),
          inventory: normalizeCharacterAdditionalValue(linkedCharacter.inventory),
          health_status: normalizeCharacterAdditionalValue(linkedCharacter.health_status),
          triggers: normalizedTriggers,
          memory_turns:
            targetCardKind === 'npc'
              ? targetMemoryTurns
              : linkedWorldCard.kind === 'npc'
                ? resolveWorldCardMemoryTurns(linkedWorldCard)
                : undefined,
        })
        const syncedCardWithAvatar = await updateStoryWorldCardAvatar({
          token: authToken,
          gameId: targetGameId,
          cardId: linkedWorldCard.id,
          avatar_url: preparedLinkedAvatarPayload.avatarUrl,
          avatar_original_url: preparedLinkedAvatarPayload.avatarOriginalUrl,
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
    characterManagerSyncCardKind,
    characterManagerSyncCardId,
    characterManagerSyncCardMemoryTurnsDraft,
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

  useEffect(() => {
    if (
      !worldCardDialogOpen ||
      !isCharacterWorldCardEditor ||
      isLoadingCharacterRaces ||
      hasLoadedCharacterRaces
    ) {
      return
    }
    void loadCharacterRaces()
  }, [
    hasLoadedCharacterRaces,
    isCharacterWorldCardEditor,
    isLoadingCharacterRaces,
    loadCharacterRaces,
    worldCardDialogOpen,
  ])

  useEffect(() => {
    if (
      (!worldCardDialogOpen && !worldCardTemplatePickerOpen) ||
      isCharacterWorldCardEditor ||
      isLoadingWorldDetailTypes ||
      hasLoadedWorldDetailTypes
    ) {
      return
    }
    void loadWorldDetailTypes()
  }, [
    hasLoadedWorldDetailTypes,
    isCharacterWorldCardEditor,
    isLoadingWorldDetailTypes,
    loadWorldDetailTypes,
    worldCardDialogOpen,
    worldCardTemplatePickerOpen,
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
    setCharacterManagerSyncCardKind(null)
    setCharacterManagerSyncCardMemoryTurnsDraft(NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS)
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
        const existingCharacter = characters.find((item) => item.id === editingCharacterId) ?? null
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
            emotion_assets: existingCharacter?.emotion_assets ?? {},
            emotion_model: existingCharacter?.emotion_model ?? null,
            emotion_prompt_lock: existingCharacter?.emotion_prompt_lock ?? null,
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
    characters,
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
          setWorldCardRaceDraft(normalizeCharacterRaceValue(createdCard.race))
          setWorldCardRaceInputDraft(normalizeCharacterRaceValue(createdCard.race))
          setWorldCardClothingDraft(normalizeCharacterAdditionalValue(createdCard.clothing))
          setWorldCardInventoryDraft(normalizeCharacterAdditionalValue(createdCard.inventory))
          setWorldCardHealthStatusDraft(normalizeCharacterAdditionalValue(createdCard.health_status))
          setWorldCardTriggersDraft(createdCard.triggers.join(', '))
          setWorldCardMemoryTurnsDraft(toNpcMemoryTurnsOption(resolveWorldCardMemoryTurns(createdCard)))
          setIsWorldCardAdditionalExpanded(
            Boolean(
              normalizeCharacterAdditionalValue(createdCard.clothing) ||
                normalizeCharacterAdditionalValue(createdCard.inventory) ||
                normalizeCharacterAdditionalValue(createdCard.health_status),
            ),
          )
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
          const preparedCharacterAvatarPayload = await prepareAvatarPayloadForRequest({
            avatarUrl: character.avatar_url,
            avatarOriginalUrl: character.avatar_original_url ?? character.avatar_url,
            maxBytes: CHARACTER_AVATAR_MAX_BYTES,
            maxDimension: 960,
          })
          const temporaryCharacter = await createStoryCharacter({
            token: authToken,
            input: {
              name: character.name,
              description: character.description,
              race: normalizeCharacterRaceValue(character.race),
              clothing: normalizeCharacterAdditionalValue(character.clothing),
              inventory: normalizeCharacterAdditionalValue(character.inventory),
              health_status: normalizeCharacterAdditionalValue(character.health_status),
              note: character.note,
              triggers: character.triggers,
              avatar_url: preparedCharacterAvatarPayload.avatarUrl,
              avatar_original_url: preparedCharacterAvatarPayload.avatarOriginalUrl,
              avatar_scale: character.avatar_scale,
              emotion_assets: character.emotion_assets ?? {},
              emotion_model: character.emotion_model ?? null,
              emotion_prompt_lock: character.emotion_prompt_lock ?? null,
              visibility: 'private',
            },
          })
          setCharacters((previous) => [...previous.filter((item) => item.id !== temporaryCharacter.id), temporaryCharacter])
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
          setWorldCardRaceDraft(normalizeCharacterRaceValue(createdCard.race))
          setWorldCardRaceInputDraft(normalizeCharacterRaceValue(createdCard.race))
          setWorldCardClothingDraft(normalizeCharacterAdditionalValue(createdCard.clothing))
          setWorldCardInventoryDraft(normalizeCharacterAdditionalValue(createdCard.inventory))
          setWorldCardHealthStatusDraft(normalizeCharacterAdditionalValue(createdCard.health_status))
          setWorldCardTriggersDraft(createdCard.triggers.join(', '))
          setWorldCardMemoryTurnsDraft(toNpcMemoryTurnsOption(resolveWorldCardMemoryTurns(createdCard)))
          setIsWorldCardAdditionalExpanded(
            Boolean(
              normalizeCharacterAdditionalValue(createdCard.clothing) ||
                normalizeCharacterAdditionalValue(createdCard.inventory) ||
                normalizeCharacterAdditionalValue(createdCard.health_status),
            ),
          )
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

  const handleOpenWorldCardAvatarPicker = useCallback((cardId: number | null, mode: 'persisted' | 'draft' = 'persisted') => {
    if (isSavingWorldCardAvatar) {
      return
    }
    setWorldCardAvatarCropSource(null)
    setWorldCardAvatarTargetId(cardId)
    setWorldCardAvatarTargetMode(mode)
    worldCardAvatarInputRef.current?.click()
  }, [isSavingWorldCardAvatar])

  const handleWorldCardAvatarChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setErrorMessage('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }
    if (selectedFile.size > CHARACTER_AVATAR_MAX_BYTES) {
      setErrorMessage('Файл слишком большой. Максимум 2 МБ.')
      return
    }

    setErrorMessage('')
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      setWorldCardAvatarCropSource(dataUrl)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обработать изображение карточки мира'
      setErrorMessage(detail)
    }
  }, [])

  const handleSaveCroppedWorldCardAvatar = useCallback(
    async (croppedDataUrl: string) => {
      if (!croppedDataUrl || isSavingWorldCardAvatar) {
        return
      }
      if (worldCardAvatarTargetMode === 'draft') {
        setWorldCardAvatarDraft(croppedDataUrl)
        setWorldCardAvatarOriginalDraft(croppedDataUrl)
        setWorldCardAvatarScaleDraft(1)
        setIsWorldCardAvatarDraftDirty(true)
        setWorldCardAvatarCropSource(null)
        setWorldCardAvatarTargetId(null)
        setWorldCardAvatarTargetMode(null)
        return
      }
      if (!activeGameId || worldCardAvatarTargetId === null) {
        return
      }

      setErrorMessage('')
      setIsSavingWorldCardAvatar(true)
      try {
        const preparedAvatarPayload = await prepareAvatarPayloadForRequest({
          avatarUrl: croppedDataUrl,
          maxBytes: CHARACTER_AVATAR_MAX_BYTES,
          maxDimension: 960,
        })
        if (!preparedAvatarPayload.avatarUrl) {
          throw new Error('Не удалось подготовить изображение карточки мира')
        }

        const updatedCard = await updateStoryWorldCardAvatar({
          token: authToken,
          gameId: activeGameId,
          cardId: worldCardAvatarTargetId,
          avatar_url: preparedAvatarPayload.avatarUrl,
          avatar_original_url: preparedAvatarPayload.avatarOriginalUrl,
          avatar_scale: 1,
        })
        setWorldCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
        setWorldCardAvatarCropSource(null)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить изображение карточки мира'
        setErrorMessage(detail)
      } finally {
        setIsSavingWorldCardAvatar(false)
        setWorldCardAvatarTargetId(null)
        setWorldCardAvatarTargetMode(null)
      }
    },
    [activeGameId, authToken, isSavingWorldCardAvatar, worldCardAvatarTargetId, worldCardAvatarTargetMode],
  )

  const handleToggleWorldCardAiEdit = useCallback(async () => {
    if (
      !activeGameId ||
      !characterStateEnabled ||
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
    characterStateEnabled,
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
    if (!activeGameId || !selectedMenuPlotCard || isPlotCardActionLocked || plotCardUsesTriggerMode(selectedMenuPlotCard)) {
      return
    }
    const targetCard = selectedMenuPlotCard
    setErrorMessage('')
    try {
      const updatedCard = await updateStoryPlotCard({
        token: authToken,
        gameId: activeGameId,
        cardId: targetCard.id,
        title: targetCard.title,
        content: targetCard.content,
        triggers: targetCard.triggers,
        memory_turns: targetCard.memory_turns,
        is_enabled: !targetCard.is_enabled,
      })
      setPlotCards((previousCards) => previousCards.map((card) => (card.id === updatedCard.id ? updatedCard : card)))
      setCardMenuAnchorEl(null)
      setCardMenuType(null)
      setCardMenuCardId(null)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить статус карточки сюжета'
      setErrorMessage(detail)
    }
  }, [
    activeGameId,
    authToken,
    isPlotCardActionLocked,
    selectedMenuPlotCard,
  ])

  const resetLoadedGameState = useCallback((nextGameId: number | null) => {
    setActiveGameId(nextGameId)
    setActiveGameSummary(null)
    setQuickStartIntro('')
    setMessages([])
    setHasOlderStoryMessages(false)
    setTurnImageByAssistantMessageId({})
    setAmbientByAssistantMessageId({})
    setPersistedAmbientProfile(null)
    setInstructionCards([])
    setPlotCards([])
    setAiMemoryBlocks([])
    setWorldCards([])
    setCanRedoAssistantStepServer(false)
    applyPlotCardEvents([])
    applyWorldCardEvents([])
  }, [applyPlotCardEvents, applyWorldCardEvents])

  const loadGameById = useCallback(
    async (
      gameId: number,
      options?: {
        silent?: boolean
        suppressErrors?: boolean
        minAssistantMessageId?: number | null
        appendOlderMessages?: boolean
        beforeMessageId?: number | null
        assistantTurnsLimit?: number | null
      },
    ): Promise<boolean> => {
      const silent = options?.silent ?? false
      const suppressErrors = options?.suppressErrors ?? false
      const appendOlderMessages = options?.appendOlderMessages ?? false
      const minAssistantMessageId = Number.isInteger(options?.minAssistantMessageId)
        ? Math.max(0, Number(options?.minAssistantMessageId))
        : 0
      const beforeMessageId = Number.isInteger(options?.beforeMessageId)
        ? Math.max(0, Number(options?.beforeMessageId))
        : 0
      const assistantTurnsLimit = Number.isInteger(options?.assistantTurnsLimit)
        ? Math.max(1, Number(options?.assistantTurnsLimit))
        : STORY_VISIBLE_ASSISTANT_TURNS_INITIAL
      if (appendOlderMessages) {
        setIsLoadingOlderStoryMessages(true)
      } else if (!silent) {
        setIsLoadingGameMessages(true)
      }
      try {
        const payload = await getStoryGame({
          token: authToken,
          gameId,
          assistantTurnsLimit,
          beforeMessageId: beforeMessageId > 0 ? beforeMessageId : null,
        })
        const normalizedMessages = normalizeStoryMessages(payload.messages)
        const normalizedInstructionCards = normalizeStoryInstructionCards(payload.instruction_cards)
        const normalizedPlotCards = normalizeStoryPlotCards(payload.plot_cards)
        const normalizedMemoryBlocks = normalizeStoryMemoryBlocks(payload.memory_blocks)
        const normalizedWorldCards = normalizeStoryWorldCards(payload.world_cards)

        const latestAssistantMessageIdFromSnapshot = normalizedMessages.reduce((maxAssistantMessageId, message) => {
          if (message.role !== 'assistant' || !Number.isInteger(message.id) || message.id <= maxAssistantMessageId) {
            return maxAssistantMessageId
          }
          return message.id
        }, 0)
        if (minAssistantMessageId > 0 && latestAssistantMessageIdFromSnapshot < minAssistantMessageId) {
          return false
        }
        setActiveGameSummary(payload.game)
        const serverOpeningScene = (payload.game.opening_scene ?? '').trim()
        setQuickStartIntro(serverOpeningScene)
        setMessages((previousMessages) => (
          appendOlderMessages
            ? mergeStoryMessagesById(previousMessages, normalizedMessages)
            : normalizedMessages
        ))
        if (appendOlderMessages && normalizedMessages.length > 0) {
          setVisibleAssistantTurns((previousTurns) => previousTurns + assistantTurnsLimit)
        }
        setHasOlderStoryMessages(Boolean(payload.has_older_messages))
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
          const nextState: Record<number, StoryTurnImageEntry[]> = appendOlderMessages
            ? { ...restoredTurnImages, ...previousState }
            : { ...restoredTurnImages }
          normalizedMessages.forEach((message) => {
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
        setInstructionCards(normalizedInstructionCards)
        setPlotCards(normalizedPlotCards)
        applyPlotCardEvents(payload.plot_card_events ?? [])
        setAiMemoryBlocks(normalizedMemoryBlocks)
        setWorldCards(normalizedWorldCards)
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
        return appendOlderMessages ? normalizedMessages.length > 0 : true
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить историю игры'
        if (!suppressErrors) {
          setErrorMessage(detail)
        }
        return false
      } finally {
        if (appendOlderMessages) {
          setIsLoadingOlderStoryMessages(false)
        } else if (!silent) {
          setIsLoadingGameMessages(false)
        }
      }
    },
    [applyPlotCardEvents, applyStoryGameSettings, applyWorldCardEvents, authToken],
  )

  const optimizeStoryMemorySnapshot = useCallback(
    async (gameId: number, messageId?: number | null) => {
      const optimizedMemoryBlocks = await optimizeStoryMemory({
        token: authToken,
        gameId,
        messageId: typeof messageId === 'number' ? messageId : null,
      })
      if (activeGameIdRef.current === gameId) {
        setAiMemoryBlocks(normalizeStoryMemoryBlocks(optimizedMemoryBlocks))
      }
      return optimizedMemoryBlocks
    },
    [authToken],
  )

  useEffect(() => {
    let isActive = true
    let deferredGameListTimerId: number | null = null
    let deferredGameListIdleId: number | null = null
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    const cancelDeferredGameListLoad = () => {
      if (deferredGameListTimerId !== null) {
        globalThis.clearTimeout(deferredGameListTimerId)
        deferredGameListTimerId = null
      }
      if (deferredGameListIdleId !== null && typeof idleWindow.cancelIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(deferredGameListIdleId)
        deferredGameListIdleId = null
      }
    }

    const bootstrap = async () => {
      setIsBootstrappingGameData(true)
      try {
        const initialTargetGameId =
          typeof initialGameId === 'number' && Number.isFinite(initialGameId) && initialGameId > 0
            ? initialGameId
            : null
        const loadAndStoreGameList = async (): Promise<StoryGameSummary[]> => {
          const loadedGames = await listStoryGames(authToken, { compact: true })
          if (!isActive) {
            return []
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
          return sortedGames
        }

        if (initialTargetGameId !== null) {
          resetLoadedGameState(initialTargetGameId)
          const activeGameLoaded = await loadGameById(initialTargetGameId, { suppressErrors: false })
          if (!isActive) {
            return
          }
          if (activeGameLoaded) {
            const runDeferredGameListLoad = () => {
              void loadAndStoreGameList().catch((error) => {
                if (!isActive) {
                  return [] as StoryGameSummary[]
                }
                const detail = error instanceof Error ? error.message : 'Не удалось загрузить список игр'
                setErrorMessage(detail)
                return [] as StoryGameSummary[]
              })
            }
            if (typeof idleWindow.requestIdleCallback === 'function') {
              deferredGameListIdleId = idleWindow.requestIdleCallback(() => {
                deferredGameListIdleId = null
                runDeferredGameListLoad()
              }, { timeout: 1200 })
            } else {
              deferredGameListTimerId = globalThis.setTimeout(() => {
                deferredGameListTimerId = null
                runDeferredGameListLoad()
              }, 240)
            }
            return
          }
          await loadAndStoreGameList().catch((error) => {
            if (!isActive) {
              return [] as StoryGameSummary[]
            }
            const detail = error instanceof Error ? error.message : 'Не удалось загрузить список игр'
            setErrorMessage(detail)
            return [] as StoryGameSummary[]
          })
          if (!isActive) {
            return
          }
          return
        }

        const sortedGames = await loadAndStoreGameList().catch((error) => {
          if (!isActive) {
            return [] as StoryGameSummary[]
          }
          const detail = error instanceof Error ? error.message : 'Не удалось загрузить список игр'
          setErrorMessage(detail)
          return [] as StoryGameSummary[]
        })
        if (!isActive) {
          return
        }

        if (sortedGames.length > 0) {
          const preferredGameId = sortedGames[0].id
          setActiveGameId(preferredGameId)
          await loadGameById(preferredGameId, {
            suppressErrors: initialTargetGameId !== null,
          })
          if (!isActive) {
            return
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
      cancelDeferredGameListLoad()
      generationAbortRef.current?.abort()
      turnImageAbortControllers.forEach((controller) => controller.abort())
      turnImageAbortControllers.clear()
    }
  }, [applyPlotCardEvents, applyWorldCardEvents, authToken, initialGameId, loadGameById, resetLoadedGameState])

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
      if (rightPanelResizingRef.current || emotionStageResizingRef.current) {
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
    const viewport = messagesViewportRef.current
    if (!viewport) {
      return
    }
    const distanceFromBottom = viewport.scrollHeight - (viewport.scrollTop + viewport.clientHeight)
    if (!isAutoScrollPaused && isGenerating && distanceFromBottom > STORY_AUTOSCROLL_BOTTOM_THRESHOLD) {
      setIsAutoScrollPaused(true)
    }

    if (viewport.scrollTop <= STORY_LOAD_OLDER_SCROLL_TOP_THRESHOLD && !isExpandingMessagesWindowRef.current) {
      if (messagesWindowStartIndex > 0) {
        isExpandingMessagesWindowRef.current = true
        pendingMessagesWindowAnchorRef.current = {
          previousScrollHeight: viewport.scrollHeight,
          previousScrollTop: viewport.scrollTop,
        }
        setVisibleAssistantTurns((previousTurns) => previousTurns + STORY_VISIBLE_ASSISTANT_TURNS_PAGE)
      } else if (
        activeGameId
        && hasOlderStoryMessages
        && !isLoadingOlderStoryMessages
        && messages.length > 0
      ) {
        isExpandingMessagesWindowRef.current = true
        pendingMessagesWindowAnchorRef.current = {
          previousScrollHeight: viewport.scrollHeight,
          previousScrollTop: viewport.scrollTop,
        }
        void loadGameById(activeGameId, {
          silent: true,
          suppressErrors: true,
          appendOlderMessages: true,
          beforeMessageId: messages[0]?.id ?? null,
          assistantTurnsLimit: STORY_VISIBLE_ASSISTANT_TURNS_PAGE,
        }).then((loadedOlderMessages) => {
          if (loadedOlderMessages) {
            return
          }
          pendingMessagesWindowAnchorRef.current = null
          isExpandingMessagesWindowRef.current = false
        })
      }
    }

    if (
      distanceFromBottom <= STORY_TRIM_TO_RECENT_SCROLL_BOTTOM_THRESHOLD
      && visibleAssistantTurns > STORY_VISIBLE_ASSISTANT_TURNS_INITIAL
      && !isExpandingMessagesWindowRef.current
    ) {
      setVisibleAssistantTurns(STORY_VISIBLE_ASSISTANT_TURNS_INITIAL)
    }
  }, [
    activeGameId,
    hasOlderStoryMessages,
    isAutoScrollPaused,
    isGenerating,
    isLoadingOlderStoryMessages,
    loadGameById,
    messages,
    messagesWindowStartIndex,
    visibleAssistantTurns,
  ])

  useEffect(() => {
    if (!isExpandingMessagesWindowRef.current) {
      return
    }
    const viewport = messagesViewportRef.current
    const anchor = pendingMessagesWindowAnchorRef.current
    pendingMessagesWindowAnchorRef.current = null
    isExpandingMessagesWindowRef.current = false
    if (!viewport || !anchor) {
      return
    }
    const nextScrollTop = anchor.previousScrollTop + Math.max(0, viewport.scrollHeight - anchor.previousScrollHeight)
    viewport.scrollTop = nextScrollTop
  }, [messagesWindowStartIndex, renderedMessages.length])

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
    async (rawValue: string) => {
      if (!activeGameId) {
        return
      }
      const normalized =
        rawValue.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().slice(0, STORY_GAME_TITLE_MAX_LENGTH)
        || DEFAULT_STORY_TITLE
      const previousServerTitle = (activeGameSummary?.title || DEFAULT_STORY_TITLE).trim() || DEFAULT_STORY_TITLE
      if (normalized === previousServerTitle) {
        applyCustomTitle(activeGameId, normalized)
        return
      }
      applyCustomTitle(activeGameId, normalized)
      try {
        const updatedGame = await updateStoryGameMeta({
          token: authToken,
          gameId: activeGameId,
          title: normalized,
        })
        applyUpdatedGameSummary(updatedGame)
      } catch (error) {
        applyCustomTitle(activeGameId, previousServerTitle)
        const detail = error instanceof Error ? error.message : 'Не удалось сохранить название мира'
        setErrorMessage(detail)
      }
    },
    [activeGameId, activeGameSummary?.title, applyCustomTitle, applyUpdatedGameSummary, authToken],
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
    void handleCommitInlineTitle(nextValue)
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
    if (!normalized && currentMessage.role !== 'assistant') {
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
        previousMessages.map((message) =>
          message.id === updatedMessage.id ? normalizeStoryMessageItem(updatedMessage) : message,
        ),
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

      const normalized = nextContentRaw.replace(/\r\n/g, '\n').slice(0, STORY_MESSAGE_MAX_LENGTH).trim()
      const currentNormalized = toStoryText(currentMessage.content).replace(/\r\n/g, '\n').trim()
      if (!normalized && currentMessage.role !== 'assistant') {
        setErrorMessage('Текст сообщения не может быть пустым')
        return
      }
      if (normalized === currentNormalized) {
        return
      }

      const previousMessagesSnapshot = messages
      const previousMemoryBlocksSnapshot = aiMemoryBlocks
      const nextRevision = (inlineMessageSaveRevisionRef.current.get(messageId) ?? 0) + 1
      inlineMessageSaveRevisionRef.current.set(messageId, nextRevision)
      setErrorMessage('')
      setMessages((previousMessages) =>
        previousMessages.map((message) =>
          message.id === messageId
            ? normalizeStoryMessageItem({
                ...message,
                content: normalized,
                updated_at: new Date().toISOString(),
              })
            : message,
        ),
      )
      if (currentMessage.role === 'assistant') {
        const latestAssistantMessageId = [...messages].reverse().find((message) => message.role === 'assistant')?.id ?? null
        if (latestAssistantMessageId === currentMessage.id) {
          const currentMessageIndex = messages.findIndex((message) => message.id === currentMessage.id)
          const previousUserMessage =
            currentMessageIndex >= 0
              ? [...messages.slice(0, currentMessageIndex)].reverse().find((message) => message.role === 'user') ?? null
              : null
          const nextRawContent = buildOptimisticRawTurnMemoryContent(
            previousUserMessage?.content ?? '',
            normalized,
            mainHeroDisplayNameForTags,
          )
          setAiMemoryBlocks((previousBlocks) => {
            const existingBlock =
              previousBlocks.find(
                (block) => block.layer === 'raw' && block.assistant_message_id === currentMessage.id,
              ) ?? null
            if (!nextRawContent) {
              return existingBlock
                ? previousBlocks.filter((block) => block.id !== existingBlock.id)
                : previousBlocks
            }
            const now = new Date().toISOString()
            const nextBlock: StoryMemoryBlock = normalizeStoryMemoryBlockItem({
              id: existingBlock?.id ?? -Date.now(),
              game_id: activeGameId,
              assistant_message_id: currentMessage.id,
              layer: 'raw',
              title: buildOptimisticRawTurnMemoryTitle(nextRawContent),
              content: nextRawContent,
              token_count: estimateTextTokens(nextRawContent),
              created_at: existingBlock?.created_at ?? now,
              updated_at: now,
            })
            const mergedBlocks = existingBlock
              ? previousBlocks.map((block) => (block.id === existingBlock.id ? nextBlock : block))
              : [...previousBlocks, nextBlock]
            return [...mergedBlocks].sort((left, right) => left.id - right.id)
          })
        }
      }
      try {
        const updatedMessage = await updateStoryMessage({
          token: authToken,
          gameId: activeGameId,
          messageId,
          content: normalized,
        })
        if (inlineMessageSaveRevisionRef.current.get(messageId) === nextRevision) {
          setMessages((previousMessages) =>
            previousMessages.map((message) =>
              message.id === updatedMessage.id ? normalizeStoryMessageItem(updatedMessage) : message,
            ),
          )
        }
      } catch (error) {
        if (inlineMessageSaveRevisionRef.current.get(messageId) === nextRevision) {
          setMessages(previousMessagesSnapshot)
          setAiMemoryBlocks(previousMemoryBlocksSnapshot)
          const detail = error instanceof Error ? error.message : 'Не удалось сохранить изменения сообщения'
          setErrorMessage(detail)
        }
      }
    },
    [
      activeGameId,
      aiMemoryBlocks,
      authToken,
      isGenerating,
      isSavingMessage,
      mainHeroDisplayNameForTags,
      messages,
    ],
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

      const normalizedTitle = toStoryText(template.title).replace(/\s+/g, ' ').trim()
      const normalizedContent = toStoryText(template.content).replace(/\r\n/g, '\n').trim()
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

  const handleOpenCreateWorldCardDialog = (kind: StoryWorldCardKind = 'world') => {
    if (isGenerating || isSavingWorldCard || isCreatingGame) {
      return
    }
    if (kind === 'world_profile' && worldProfileCard) {
      handleOpenEditWorldCardDialog(worldProfileCard)
      return
    }
    setEditingWorldCardId(null)
    setEditingWorldCardKind(kind)
    setWorldCardTitleDraft('')
    setWorldCardContentDraft('')
    setWorldCardDetailTypeDraft('')
    setWorldCardRaceDraft('')
    setWorldCardRaceInputDraft('')
    setWorldCardClothingDraft('')
    setWorldCardInventoryDraft('')
    setWorldCardHealthStatusDraft('')
    setWorldCardTriggersDraft('')
    setWorldCardMemoryTurnsDraft(kind === 'npc' ? NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS : WORLD_CARD_TRIGGER_ACTIVE_TURNS)
    setWorldCardAvatarDraft(null)
    setWorldCardAvatarOriginalDraft(null)
    setWorldCardAvatarScaleDraft(1)
    setIsWorldCardAvatarDraftDirty(false)
    setIsWorldCardAdditionalExpanded(false)
    setWorldCardAvatarCropSource(null)
    setWorldCardAvatarTargetId(null)
    setWorldCardAvatarTargetMode(null)
    setWorldCardDialogOpen(true)
  }

  const handleOpenEditWorldCardDialog = (card: StoryWorldCard) => {
    if (isGenerating || isSavingWorldCard || isCreatingGame) {
      return
    }
    if (false && (card.kind === 'main_hero' || card.kind === 'npc')) {
      const resolvedLinkedCharacter = resolveLinkedCharacterForWorldCard(card)
      const rawCharacterId = card.character_id
      const numericCharacterId = Number(rawCharacterId)
      const directCharacterId =
        Number.isFinite(numericCharacterId) && numericCharacterId > 0 ? numericCharacterId : null
      const linkedCharacterId =
        resolvedLinkedCharacter?.id ?? directCharacterId ?? worldCardCharacterMirrorByCardId[card.id] ?? null
      const hasLinkedCharacter =
        linkedCharacterId !== null ? characters.some((item) => item.id === linkedCharacterId) : false
      if (linkedCharacterId !== null && linkedCharacterId > 0 && hasLinkedCharacter) {
        handleOpenCharacterManager({
          initialCharacterId: linkedCharacterId,
          syncCardId: card.id,
          syncCardKind: card.kind,
          memoryTurns: card.kind === 'npc' ? toNpcMemoryTurnsOption(resolveWorldCardMemoryTurns(card)) : NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS,
        })
        return
      }

      void (async () => {
        try {
          const normalizedName = toStoryText(card.title).replace(/\s+/g, ' ').trim() || 'Персонаж'
          const normalizedDescription = toStoryText(card.content).replace(/\r\n/g, '\n').trim() || 'Описание персонажа'
          const normalizedTriggers =
            Array.isArray(card.triggers) && card.triggers.length > 0
              ? card.triggers
              : normalizeCharacterTriggersDraft('', normalizedName)
          const linkedCharacter = resolveLinkedCharacterForWorldCard(card)
          const preparedMirroredAvatarPayload = await prepareAvatarPayloadForRequest({
            avatarUrl: resolveWorldCardAvatar(card),
            avatarOriginalUrl:
              resolveWorldCardPreviewAvatar(card) ??
              resolveLinkedCharacterPreviewAvatar(card) ??
              resolveWorldCardAvatar(card),
            maxBytes: CHARACTER_AVATAR_MAX_BYTES,
            maxDimension: 960,
          })
          const mirroredCharacter = await createStoryCharacter({
            token: authToken,
            input: {
              name: normalizedName,
              description: normalizedDescription,
              race: normalizeCharacterRaceValue(card.race),
              clothing: normalizeCharacterAdditionalValue(card.clothing),
              inventory: normalizeCharacterAdditionalValue(card.inventory),
              health_status: normalizeCharacterAdditionalValue(card.health_status),
              note: '',
              triggers: normalizedTriggers,
              avatar_url: preparedMirroredAvatarPayload.avatarUrl,
              avatar_original_url: preparedMirroredAvatarPayload.avatarOriginalUrl,
              avatar_scale: card.avatar_scale,
              emotion_assets: linkedCharacter?.emotion_assets ?? {},
              emotion_model: linkedCharacter?.emotion_model ?? null,
              emotion_prompt_lock: linkedCharacter?.emotion_prompt_lock ?? null,
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
            syncCardKind: card.kind,
            memoryTurns: card.kind === 'npc' ? toNpcMemoryTurnsOption(resolveWorldCardMemoryTurns(card)) : NPC_WORLD_CARD_TRIGGER_ACTIVE_TURNS,
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
    setWorldCardDetailTypeDraft(normalizeStoryWorldDetailTypeValue(card.detail_type))
    setWorldCardRaceDraft(normalizeCharacterRaceValue(card.race))
    setWorldCardRaceInputDraft(normalizeCharacterRaceValue(card.race))
    setWorldCardClothingDraft(normalizeCharacterAdditionalValue(card.clothing))
    setWorldCardInventoryDraft(normalizeCharacterAdditionalValue(card.inventory))
    setWorldCardHealthStatusDraft(normalizeCharacterAdditionalValue(card.health_status))
    setWorldCardTriggersDraft(card.triggers.join(', '))
    setWorldCardMemoryTurnsDraft(toNpcMemoryTurnsOption(resolveWorldCardMemoryTurns(card)))
    setWorldCardAvatarDraft(resolveWorldCardAvatar(card))
    setWorldCardAvatarOriginalDraft(resolveWorldCardPreviewAvatar(card) ?? resolveWorldCardAvatar(card))
    setWorldCardAvatarScaleDraft(card.avatar_scale ?? 1)
    setIsWorldCardAvatarDraftDirty(false)
    setIsWorldCardAdditionalExpanded(
      Boolean(
        normalizeCharacterAdditionalValue(card.clothing) ||
          normalizeCharacterAdditionalValue(card.inventory) ||
          normalizeCharacterAdditionalValue(card.health_status),
      ),
    )
    setWorldCardAvatarCropSource(null)
    setWorldCardAvatarTargetId(null)
    setWorldCardAvatarTargetMode(null)
    setWorldCardDialogOpen(true)
  }

  const forceCloseWorldCardDialog = () => {
    if (isSavingWorldCard || isCreatingGame || isSavingWorldCardAvatar) {
      return
    }
    setWorldCardCloseConfirmOpen(false)
    setWorldCardDialogOpen(false)
    setEditingWorldCardId(null)
    setEditingWorldCardKind('world')
    setWorldCardTitleDraft('')
    setWorldCardContentDraft('')
    setWorldCardDetailTypeDraft('')
    setWorldCardRaceDraft('')
    setWorldCardRaceInputDraft('')
    setWorldCardClothingDraft('')
    setWorldCardInventoryDraft('')
    setWorldCardHealthStatusDraft('')
    setWorldCardTriggersDraft('')
    setWorldCardMemoryTurnsDraft(WORLD_CARD_TRIGGER_ACTIVE_TURNS)
    setWorldCardAvatarDraft(null)
    setWorldCardAvatarOriginalDraft(null)
    setWorldCardAvatarScaleDraft(1)
    setIsWorldCardAvatarDraftDirty(false)
    setIsWorldCardAdditionalExpanded(false)
    setWorldCardAvatarCropSource(null)
    setWorldCardAvatarTargetId(null)
    setWorldCardAvatarTargetMode(null)
  }

  const handleCloseWorldCardDialog = () => {
    if (isSavingWorldCard || isCreatingGame || isSavingWorldCardAvatar) {
      return
    }
    if (hasWorldCardDialogUnsavedChanges) {
      setWorldCardCloseConfirmOpen(true)
      return
    }
    forceCloseWorldCardDialog()
  }

  const handleCreateCharacterRace = useCallback(
    async (rawValue: string): Promise<string | null> => {
      const normalizedValue = normalizeCharacterRaceValue(rawValue)
      if (!normalizedValue) {
        return ''
      }
      const existingOption = worldCardRaceOptions.find(
        (option) => option.value.toLocaleLowerCase() === normalizedValue.toLocaleLowerCase(),
      )
      if (existingOption) {
        return existingOption.value
      }
      setIsSavingCharacterRace(true)
      setErrorMessage('')
      try {
        const createdRace = await createStoryCharacterRace({
          token: authToken,
          name: normalizedValue,
        })
        const normalizedCreatedValue = normalizeCharacterRaceValue(createdRace.name)
        setCharacterRaceOptions((previous) => {
          const nextItems = [...previous]
          const existingIndex = nextItems.findIndex(
            (item) => normalizeCharacterRaceValue(item.name).toLocaleLowerCase() === normalizedCreatedValue.toLocaleLowerCase(),
          )
          if (existingIndex >= 0) {
            nextItems[existingIndex] = createdRace
          } else {
            nextItems.push(createdRace)
          }
          nextItems.sort((left, right) =>
            normalizeCharacterRaceValue(left.name).localeCompare(normalizeCharacterRaceValue(right.name), 'ru', {
              sensitivity: 'base',
            }),
          )
          return nextItems
        })
        return normalizedCreatedValue
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось сохранить расу персонажа'
        setErrorMessage(detail)
        return null
      } finally {
        setIsSavingCharacterRace(false)
      }
    },
    [authToken, worldCardRaceOptions],
  )

  const handleCreateWorldDetailType = useCallback(
    async (rawValue: string): Promise<string | null> => {
      const normalizedValue = normalizeStoryWorldDetailTypeValue(rawValue)
      if (!normalizedValue) {
        return ''
      }
      const existingOption = worldDetailTypeAutocompleteOptions.find(
        (option) => option.value.toLocaleLowerCase() === normalizedValue.toLocaleLowerCase(),
      )
      if (existingOption) {
        return existingOption.value
      }
      setIsSavingWorldDetailType(true)
      setErrorMessage('')
      try {
        const createdType = await createStoryWorldDetailType({
          token: authToken,
          name: normalizedValue,
        })
        const normalizedCreatedValue = normalizeStoryWorldDetailTypeValue(createdType.name)
        setWorldDetailTypeOptions((previous) => {
          const nextItems = [...previous]
          const existingIndex = nextItems.findIndex(
            (item) =>
              normalizeStoryWorldDetailTypeValue(item.name).toLocaleLowerCase() ===
              normalizedCreatedValue.toLocaleLowerCase(),
          )
          if (existingIndex >= 0) {
            nextItems[existingIndex] = createdType
          } else {
            nextItems.push(createdType)
          }
          nextItems.sort((left, right) =>
            normalizeStoryWorldDetailTypeValue(left.name).localeCompare(
              normalizeStoryWorldDetailTypeValue(right.name),
              'ru',
              { sensitivity: 'base' },
            ),
          )
          return nextItems
        })
        return normalizedCreatedValue
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось сохранить тип детали мира'
        setErrorMessage(detail)
        return null
      } finally {
        setIsSavingWorldDetailType(false)
      }
    },
    [authToken, worldDetailTypeAutocompleteOptions],
  )

  const handleWorldCardRaceSelectionChange = useCallback(
    async (_event: unknown, option: CharacterRaceOption | null) => {
      if (!option) {
        setWorldCardRaceDraft('')
        setWorldCardRaceInputDraft('')
        return
      }
      if (option.isCreateAction) {
        const createdValue = await handleCreateCharacterRace(option.value)
        if (createdValue === null) {
          return
        }
        setWorldCardRaceDraft(createdValue)
        setWorldCardRaceInputDraft(createdValue)
        return
      }
      setWorldCardRaceDraft(option.value)
      setWorldCardRaceInputDraft(option.value)
    },
    [handleCreateCharacterRace],
  )

  const handleWorldCardDetailTypeSelectionChange = useCallback(
    async (_event: unknown, option: WorldDetailTypeAutocompleteOption | null) => {
      if (!option) {
        setWorldCardDetailTypeDraft('')
        return
      }
      if (option.isCreateAction) {
        const createdValue = await handleCreateWorldDetailType(option.value)
        if (createdValue === null) {
          return
        }
        setWorldCardDetailTypeDraft(createdValue)
        return
      }
      setWorldCardDetailTypeDraft(option.value)
    },
    [handleCreateWorldDetailType],
  )

  const handleSaveWorldCard = useCallback(async () => {
    if (isSavingWorldCard || isCreatingGame) {
      return
    }

    const normalizedTitle = worldCardTitleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = worldCardContentDraft.replace(/\r\n/g, '\n').trim()
    let normalizedDetailType = normalizeStoryWorldDetailTypeValue(worldCardDetailTypeDraft)
    const normalizedRace = normalizeCharacterRaceValue(worldCardRaceDraft)
    const normalizedClothing = normalizeCharacterAdditionalValue(worldCardClothingDraft)
    const normalizedInventory = normalizeCharacterAdditionalValue(worldCardInventoryDraft)
    const normalizedHealthStatus = normalizeCharacterAdditionalValue(worldCardHealthStatusDraft)

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

    if (editingWorldCardKind === 'world' && !normalizedDetailType) {
      setErrorMessage('Укажите тип детали мира')
      return
    }

    const normalizedTriggers =
      editingWorldCardKind === 'world_profile'
        ? normalizeWorldCardTriggersDraft('', normalizedTitle)
        : normalizeWorldCardTriggersDraft(worldCardTriggersDraft, normalizedTitle)
    const normalizedMemoryTurns =
      editingWorldCardKind === 'npc' || editingWorldCardKind === 'world'
        ? worldCardMemoryTurnsDraft
        : editingWorldCardKind === 'world_profile'
          ? null
          : undefined
    const shouldPersistWorldCardBanner = editingWorldCardKind === 'world' || editingWorldCardKind === 'world_profile'

    setErrorMessage('')
    setIsSavingWorldCard(true)
    try {
      const targetGameId = activeGameId ?? (await ensureGameForInstructionCard())
      if (!targetGameId) {
        return
      }

      if (editingWorldCardKind === 'world' && normalizedDetailType) {
        const hasExistingDetailType = worldDetailTypeOptions.some(
          (item) =>
            normalizeStoryWorldDetailTypeValue(item.name).toLocaleLowerCase() === normalizedDetailType.toLocaleLowerCase(),
        )
        if (!hasExistingDetailType) {
          const createdDetailType = await handleCreateWorldDetailType(normalizedDetailType)
          if (createdDetailType === null) {
            return
          }
          normalizedDetailType = createdDetailType
        }
      }

      const preparedAvatarPayload = shouldPersistWorldCardBanner
        ? await prepareAvatarPayloadForRequest({
            avatarUrl: worldCardAvatarDraft,
            avatarOriginalUrl: worldCardAvatarOriginalDraft ?? worldCardAvatarDraft,
            maxBytes: CHARACTER_AVATAR_MAX_BYTES,
            maxDimension: 1280,
          })
        : { avatarUrl: null, avatarOriginalUrl: null }

      if (editingWorldCardId === null) {
        const createdCard = await createStoryWorldCard({
          token: authToken,
          gameId: targetGameId,
          title: normalizedTitle,
          content: normalizedContent,
          race: normalizedRace,
          clothing: normalizedClothing,
          inventory: normalizedInventory,
          health_status: normalizedHealthStatus,
          triggers: normalizedTriggers,
          kind: editingWorldCardKind,
          detail_type: editingWorldCardKind === 'world' ? normalizedDetailType : '',
          avatar_url: shouldPersistWorldCardBanner ? preparedAvatarPayload.avatarUrl : null,
          avatar_original_url: shouldPersistWorldCardBanner ? preparedAvatarPayload.avatarOriginalUrl : null,
          avatar_scale: shouldPersistWorldCardBanner ? worldCardAvatarScaleDraft : undefined,
          memory_turns: normalizedMemoryTurns,
        })
        setWorldCards((previousCards) =>
          editingWorldCardKind === 'world_profile'
            ? [...previousCards.filter((card) => card.kind !== 'world_profile'), createdCard]
            : [...previousCards, createdCard],
        )
      } else {
        const updatedCard = await updateStoryWorldCard({
          token: authToken,
          gameId: targetGameId,
          cardId: editingWorldCardId,
          title: normalizedTitle,
          content: normalizedContent,
          race: normalizedRace,
          clothing: normalizedClothing,
          inventory: normalizedInventory,
          health_status: normalizedHealthStatus,
          triggers: normalizedTriggers,
          detail_type: editingWorldCardKind === 'world' ? normalizedDetailType : '',
          memory_turns: normalizedMemoryTurns,
        })
        const finalCard =
          shouldPersistWorldCardBanner && isWorldCardAvatarDraftDirty
            ? await updateStoryWorldCardAvatar({
                token: authToken,
                gameId: targetGameId,
                cardId: editingWorldCardId,
                avatar_url: preparedAvatarPayload.avatarUrl,
                avatar_original_url: preparedAvatarPayload.avatarOriginalUrl,
                avatar_scale: worldCardAvatarScaleDraft,
              })
            : updatedCard
        setWorldCards((previousCards) => previousCards.map((card) => (card.id === finalCard.id ? finalCard : card)))
      }

      setWorldCardDialogOpen(false)
      setEditingWorldCardId(null)
      setEditingWorldCardKind('world')
      setWorldCardTitleDraft('')
      setWorldCardContentDraft('')
      setWorldCardDetailTypeDraft('')
      setWorldCardRaceDraft('')
      setWorldCardRaceInputDraft('')
      setWorldCardClothingDraft('')
      setWorldCardInventoryDraft('')
      setWorldCardHealthStatusDraft('')
      setWorldCardTriggersDraft('')
      setWorldCardMemoryTurnsDraft(WORLD_CARD_TRIGGER_ACTIVE_TURNS)
      setWorldCardAvatarDraft(null)
      setWorldCardAvatarOriginalDraft(null)
      setWorldCardAvatarScaleDraft(1)
      setIsWorldCardAvatarDraftDirty(false)
      setIsWorldCardAdditionalExpanded(false)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить карточку мира'
      setErrorMessage(detail)
    } finally {
      setIsSavingWorldCard(false)
    }
  }, [
    activeGameId,
    authToken,
    editingWorldCardId,
    editingWorldCardKind,
    ensureGameForInstructionCard,
    handleCreateWorldDetailType,
    isCreatingGame,
    isSavingWorldCard,
    isWorldCardAvatarDraftDirty,
    worldCardAvatarDraft,
    worldCardAvatarOriginalDraft,
    worldCardAvatarScaleDraft,
    worldCardContentDraft,
    worldCardDetailTypeDraft,
    worldCardClothingDraft,
    worldCardHealthStatusDraft,
    worldCardInventoryDraft,
    worldCardMemoryTurnsDraft,
    worldCardRaceDraft,
    worldCardTitleDraft,
    worldCardTriggersDraft,
    worldDetailTypeOptions,
  ])

  const handleApplyWorldCardTemplate = useCallback(
    async (template: {
      id: number
      title: string
      content: string
      triggers: string[]
      kind: 'world' | 'world_profile'
      detail_type: string
      avatar_url: string | null
      avatar_original_url?: string | null
      avatar_scale: number
      memory_turns: number | null
    }) => {
      if (isSavingWorldCard || isCreatingGame) {
        return
      }
      if (template.kind === 'world_profile' && worldProfileCard) {
        setWorldCardTemplatePickerOpen(false)
        setErrorMessage('Описание мира уже создано. Его можно только изменить.')
        return
      }

      setErrorMessage('')
      setWorldCardTemplatePickerOpen(false)
      setIsSavingWorldCard(true)
      try {
        const targetGameId = activeGameId ?? (await ensureGameForInstructionCard())
        if (!targetGameId) {
          return
        }

        const createdCard = await createStoryWorldCard({
          token: authToken,
          gameId: targetGameId,
          title: template.title,
          content: template.content,
          triggers: template.triggers,
          kind: template.kind,
          detail_type: template.kind === 'world' ? template.detail_type : '',
          avatar_url: template.avatar_url,
          avatar_original_url: template.avatar_original_url ?? null,
          avatar_scale: template.avatar_scale,
          memory_turns: template.memory_turns,
        })
        setWorldCards((previousCards) =>
          template.kind === 'world_profile'
            ? [...previousCards.filter((card) => card.kind !== 'world_profile'), createdCard]
            : [...previousCards, createdCard],
        )
        if (template.kind === 'world' && template.detail_type.trim()) {
          const normalizedDetailType = normalizeStoryWorldDetailTypeValue(template.detail_type)
          setWorldDetailTypeOptions((previous) => {
            const alreadyExists = previous.some(
              (item) => normalizeStoryWorldDetailTypeValue(item.name).toLocaleLowerCase() === normalizedDetailType.toLocaleLowerCase(),
            )
            if (alreadyExists) {
              return previous
            }
            const now = new Date().toISOString()
            return [
              ...previous,
              {
                id: -Date.now(),
                name: normalizedDetailType,
                created_at: now,
                updated_at: now,
              },
            ]
          })
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось применить шаблон карточки мира'
        setErrorMessage(detail)
      } finally {
        setIsSavingWorldCard(false)
      }
    },
    [
      activeGameId,
      authToken,
      ensureGameForInstructionCard,
      isCreatingGame,
      isSavingWorldCard,
      worldProfileCard,
    ],
  )

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
          setWorldCardDetailTypeDraft('')
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
      const normalizedNextBlock = normalizeStoryMemoryBlockItem(nextBlock)

      setAiMemoryBlocks((previousBlocks) => {
        const hasBlock = previousBlocks.some((block) => block.id === normalizedNextBlock.id)
        const mergedBlocks = hasBlock
          ? previousBlocks.map((block) => (block.id === normalizedNextBlock.id ? normalizedNextBlock : block))
          : [...previousBlocks, normalizedNextBlock]
        return [...mergedBlocks].sort((left, right) => left.id - right.id)
      })
      setOpenedAiMemoryBlockId(normalizedNextBlock.id)
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
        message: `Инструкция «${normalizedTitle}» будет удалена только из этой игры. Если исходный шаблон есть в профиле, он останется без изменений.`, 
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

  const toggleAdvancedRegenerationEnabled = useCallback(() => {
    if (!activeGameId || isGenerating) {
      return
    }

    const nextValue = !advancedRegenerationEnabled
    setAdvancedRegenerationEnabled(nextValue)
    if (!nextValue) {
      setAdvancedRegenerationDialogOpen(false)
    }
    try {
      const storageKey = buildAdvancedRegenerationStorageKey(user.id, activeGameId)
      if (nextValue) {
        localStorage.setItem(storageKey, '1')
      } else {
        localStorage.removeItem(storageKey)
      }
    } catch {
      // LocalStorage can be unavailable in private modes; the in-memory setting still works.
    }
  }, [activeGameId, advancedRegenerationEnabled, isGenerating, user.id])

  const toggleSmoothStreamingEnabled = useCallback(() => {
    setSmoothStreamingEnabled((previousValue) => {
      const nextValue = !previousValue
      writeSmoothStreamingPreference(nextValue)
      return nextValue
    })
  }, [])

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
      const nextSamplingDefaults = getStoryNarratorSamplingDefaults(normalizedModel)
      const previousStoryLlmModel = storyLlmModel
      const previousStoryTemperature = storyTemperature
      const previousStoryRepetitionPenalty = storyRepetitionPenalty
      const previousMemoryOptimizationEnabled = memoryOptimizationEnabled
      const previousStoryTopK = storyTopK
      const previousStoryTopR = storyTopR
      const previousShowGgThoughts = showGgThoughts
      const previousShowNpcThoughts = showNpcThoughts
      const previousAmbientEnabled = ambientEnabled
      const previousResponseMaxTokens = responseMaxTokens
      const previousResponseMaxTokensEnabled = responseMaxTokensEnabled
      setStoryLlmModel(normalizedModel)
      setStoryTemperature(nextSamplingDefaults.storyTemperature)
      setStoryRepetitionPenalty(nextSamplingDefaults.storyRepetitionPenalty)
      setStoryRepetitionPenaltyDraft(nextSamplingDefaults.storyRepetitionPenalty.toFixed(2))
      setStoryTopK(nextSamplingDefaults.storyTopK)
      setStoryTopR(nextSamplingDefaults.storyTopR)
      setStorySettingsOverrides((previousOverrides) => ({
        ...previousOverrides,
        [targetGameId]: {
          ...previousOverrides[targetGameId],
          storyLlmModel: normalizedModel,
          responseMaxTokens: previousResponseMaxTokens,
          responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
          memoryOptimizationEnabled: previousMemoryOptimizationEnabled,
          memoryOptimizationMode,
          storyTemperature: nextSamplingDefaults.storyTemperature,
          storyRepetitionPenalty: nextSamplingDefaults.storyRepetitionPenalty,
          storyTopK: nextSamplingDefaults.storyTopK,
          storyTopR: nextSamplingDefaults.storyTopR,
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
          storyTemperature: nextSamplingDefaults.storyTemperature,
          storyRepetitionPenalty: nextSamplingDefaults.storyRepetitionPenalty,
          storyTopK: nextSamplingDefaults.storyTopK,
          storyTopR: nextSamplingDefaults.storyTopR,
          showGgThoughts: previousShowGgThoughts,
          showNpcThoughts: previousShowNpcThoughts,
          ambientEnabled: previousAmbientEnabled,
        })
        const persistedContextLimit = clampStoryContextLimit(updatedGame.context_limit_chars)
        setContextLimitChars(persistedContextLimit)
        setContextLimitDraft(String(persistedContextLimit))
        const persistedModel = normalizeStoryNarratorModelId(updatedGame.story_llm_model)
        const persistedTemperature =
          typeof updatedGame.story_temperature === 'number'
            ? clampStoryTemperature(updatedGame.story_temperature)
            : nextSamplingDefaults.storyTemperature
        const persistedRepetitionPenalty =
          typeof updatedGame.story_repetition_penalty === 'number'
            ? clampStoryRepetitionPenalty(updatedGame.story_repetition_penalty)
            : nextSamplingDefaults.storyRepetitionPenalty
        const persistedTopK =
          typeof updatedGame.story_top_k === 'number'
            ? clampStoryTopK(updatedGame.story_top_k)
            : nextSamplingDefaults.storyTopK
        const persistedTopR =
          typeof updatedGame.story_top_r === 'number'
            ? clampStoryTopR(updatedGame.story_top_r)
            : nextSamplingDefaults.storyTopR
        setStoryLlmModel(persistedModel)
        setStoryTemperature(persistedTemperature)
        setStoryRepetitionPenalty(persistedRepetitionPenalty)
        setStoryRepetitionPenaltyDraft(persistedRepetitionPenalty.toFixed(2))
        setStoryTopK(persistedTopK)
        setStoryTopR(persistedTopR)
        setStorySettingsOverrides((previousOverrides) => ({
          ...previousOverrides,
          [targetGameId]: {
            ...previousOverrides[targetGameId],
            storyLlmModel: persistedModel,
            responseMaxTokens: previousResponseMaxTokens,
            responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
            memoryOptimizationEnabled: previousMemoryOptimizationEnabled,
            memoryOptimizationMode,
            storyTemperature: persistedTemperature,
            storyRepetitionPenalty: persistedRepetitionPenalty,
            storyTopK: persistedTopK,
            storyTopR: persistedTopR,
            showGgThoughts: previousShowGgThoughts,
            showNpcThoughts: previousShowNpcThoughts,
            ambientEnabled: previousAmbientEnabled,
          },
        }))
        setGames((previousGames) =>
          sortGamesByActivity(
            previousGames.map((game) =>
              game.id === updatedGame.id
                ? {
                    ...updatedGame,
                    story_llm_model: persistedModel,
                    memory_optimization_enabled: previousMemoryOptimizationEnabled,
                    story_temperature: persistedTemperature,
                    story_repetition_penalty: persistedRepetitionPenalty,
                    story_top_k: persistedTopK,
                    story_top_r: persistedTopR,
                    show_gg_thoughts: previousShowGgThoughts,
                    show_npc_thoughts: previousShowNpcThoughts,
                  }
                : game,
            ),
          ),
        )
      } catch (error) {
        setStoryLlmModel(previousStoryLlmModel)
        setStoryTemperature(previousStoryTemperature)
        setStoryRepetitionPenalty(previousStoryRepetitionPenalty)
        setStoryRepetitionPenaltyDraft(previousStoryRepetitionPenalty.toFixed(2))
        setStoryTopK(previousStoryTopK)
        setStoryTopR(previousStoryTopR)
        setStorySettingsOverrides((previousOverrides) => ({
          ...previousOverrides,
          [targetGameId]: {
            ...previousOverrides[targetGameId],
            storyLlmModel: previousStoryLlmModel,
            responseMaxTokens: previousResponseMaxTokens,
            responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
            memoryOptimizationEnabled: previousMemoryOptimizationEnabled,
            memoryOptimizationMode,
            storyTemperature: previousStoryTemperature,
            storyRepetitionPenalty: previousStoryRepetitionPenalty,
            storyTopK: previousStoryTopK,
            storyTopR: previousStoryTopR,
            showGgThoughts: previousShowGgThoughts,
            showNpcThoughts: previousShowNpcThoughts,
            ambientEnabled: previousAmbientEnabled,
          },
        }))
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
      storyTemperature,
      storyRepetitionPenalty,
      storyTopK,
      storyTopR,
      storyLlmModel,
    ],
  )

  const persistStoryMemoryOptimizationMode = useCallback(
    async (nextMode: StoryMemoryOptimizationMode) => {
      const targetGameId = activeGameId
      if (
        !targetGameId ||
        isSavingMemoryOptimization ||
        isSavingResponseMaxTokens ||
        isSavingResponseMaxTokensEnabled ||
        isSavingContextLimit ||
        isSavingStoryLlmModel ||
        isSavingStoryImageModel ||
        isSavingImageStylePrompt ||
        isSavingStorySampling ||
        isSavingThoughtVisibility ||
        isSavingAmbientEnabled ||
        isGenerating
      ) {
        return
      }

      const normalizedMode = normalizeStoryMemoryOptimizationMode(nextMode)
      if (normalizedMode === memoryOptimizationMode) {
        return
      }

      const previousMode = memoryOptimizationMode
      setMemoryOptimizationMode(normalizedMode)
      setStorySettingsOverrides((previousOverrides) => ({
        ...previousOverrides,
        [targetGameId]: {
          ...previousOverrides[targetGameId],
          storyLlmModel,
          responseMaxTokens,
          responseMaxTokensEnabled,
          memoryOptimizationEnabled,
          memoryOptimizationMode: normalizedMode,
          storyTopK,
          storyTopR,
          storyTemperature,
          showGgThoughts,
          showNpcThoughts,
          ambientEnabled,
          characterStateEnabled,
          emotionVisualizationEnabled,
        },
      }))
      setErrorMessage('')
      setIsSavingMemoryOptimization(true)
      try {
        const updatedGame = await updateStoryGameSettings({
          token: authToken,
          gameId: targetGameId,
          memoryOptimizationMode: normalizedMode,
        })
        const persistedMode = normalizeStoryMemoryOptimizationMode(updatedGame.memory_optimization_mode)
        setMemoryOptimizationMode(persistedMode)
        setGames((previousGames) =>
          sortGamesByActivity(previousGames.map((game) => (game.id === updatedGame.id ? updatedGame : game))),
        )
      } catch (error) {
        setMemoryOptimizationMode(previousMode)
        setStorySettingsOverrides((previousOverrides) => ({
          ...previousOverrides,
          [targetGameId]: {
            ...previousOverrides[targetGameId],
            storyLlmModel,
            responseMaxTokens,
            responseMaxTokensEnabled,
            memoryOptimizationEnabled,
            memoryOptimizationMode: previousMode,
            storyTopK,
            storyTopR,
            storyTemperature,
            showGgThoughts,
            showNpcThoughts,
            ambientEnabled,
            characterStateEnabled,
            emotionVisualizationEnabled,
          },
        }))
        const detail = error instanceof Error ? error.message : 'Не удалось обновить режим оптимизации памяти'
        setErrorMessage(detail)
      } finally {
        setIsSavingMemoryOptimization(false)
      }
    },
    [
      activeGameId,
      authToken,
      ambientEnabled,
      characterStateEnabled,
      emotionVisualizationEnabled,
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
      memoryOptimizationMode,
      responseMaxTokens,
      responseMaxTokensEnabled,
      showGgThoughts,
      showNpcThoughts,
      storyImageModel,
      storyLlmModel,
      storyTemperature,
      storyTopK,
      storyTopR,
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
        ...previousOverrides[targetGameId],
        storyLlmModel: previousStoryLlmModel,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        memoryOptimizationMode,
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
        ...previousOverrides[targetGameId],
        storyLlmModel: previousStoryLlmModel,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        memoryOptimizationMode,
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

  const toggleCharacterStateEnabled = useCallback(async () => {
    const targetGameId = activeGameId
    if (
      !targetGameId ||
      isSavingCharacterStateEnabled ||
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

    const nextValue = !characterStateEnabled
    const previousValue = characterStateEnabled
    const previousStoryLlmModel = storyLlmModel
    const previousMemoryOptimization = memoryOptimizationEnabled
    const previousStoryTopK = storyTopK
    const previousStoryTopR = storyTopR
    const previousShowGgThoughts = showGgThoughts
    const previousShowNpcThoughts = showNpcThoughts
    const previousAmbientEnabled = ambientEnabled
    const previousResponseMaxTokens = responseMaxTokens
    const previousResponseMaxTokensEnabled = responseMaxTokensEnabled

    setCharacterStateEnabled(nextValue)
    setStorySettingsOverrides((previousOverrides) => ({
      ...previousOverrides,
      [targetGameId]: {
        ...previousOverrides[targetGameId],
        storyLlmModel: previousStoryLlmModel,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        memoryOptimizationMode,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: previousShowNpcThoughts,
        ambientEnabled: previousAmbientEnabled,
        characterStateEnabled: nextValue,
      },
    }))
    setErrorMessage('')
    setIsSavingCharacterStateEnabled(true)
    try {
      const updatedGame = await updateStoryGameSettings({
        token: authToken,
        gameId: targetGameId,
        characterStateEnabled: nextValue,
        contextLimitTokens: contextLimitChars,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: previousShowNpcThoughts,
        ambientEnabled: previousAmbientEnabled,
      })
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
                  ambient_enabled: previousAmbientEnabled,
                  character_state_enabled: nextValue,
                }
              : game,
          ),
        ),
      )
    } catch (error) {
      setCharacterStateEnabled(previousValue)
      setStorySettingsOverrides((previousOverrides) => ({
        ...previousOverrides,
        [targetGameId]: {
          ...previousOverrides[targetGameId],
          storyLlmModel: previousStoryLlmModel,
          responseMaxTokens: previousResponseMaxTokens,
          responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
          memoryOptimizationEnabled: previousMemoryOptimization,
          memoryOptimizationMode,
          storyTopK: previousStoryTopK,
          storyTopR: previousStoryTopR,
          showGgThoughts: previousShowGgThoughts,
          showNpcThoughts: previousShowNpcThoughts,
          ambientEnabled: previousAmbientEnabled,
          characterStateEnabled: previousValue,
        },
      }))
      const detail = error instanceof Error ? error.message : 'Не удалось обновить авто состояние персонажей'
      setErrorMessage(detail)
    } finally {
      setIsSavingCharacterStateEnabled(false)
    }
  }, [
    activeGameId,
    ambientEnabled,
    authToken,
    characterStateEnabled,
    contextLimitChars,
    isGenerating,
    isSavingAmbientEnabled,
    isSavingCharacterStateEnabled,
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

  const toggleEmotionVisualizationEnabled = useCallback(async () => {
    const targetGameId = activeGameId
    if (
      !isAdministrator ||
      !targetGameId ||
      isSavingEmotionVisualizationEnabled ||
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

    const nextValue = !emotionVisualizationEnabled
    const previousStoryLlmModel = storyLlmModel
    const previousMemoryOptimization = memoryOptimizationEnabled
    const previousStoryTopK = storyTopK
    const previousStoryTopR = storyTopR
    const previousShowGgThoughts = showGgThoughts
    const previousShowNpcThoughts = showNpcThoughts
    const previousAmbientEnabled = ambientEnabled
    const previousResponseMaxTokens = responseMaxTokens
    const previousResponseMaxTokensEnabled = responseMaxTokensEnabled

    setEmotionVisualizationEnabled(nextValue)
    setStorySettingsOverrides((previousOverrides) => ({
      ...previousOverrides,
      [targetGameId]: {
        ...previousOverrides[targetGameId],
        storyLlmModel: previousStoryLlmModel,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        memoryOptimizationMode,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: previousShowNpcThoughts,
        ambientEnabled: previousAmbientEnabled,
        emotionVisualizationEnabled: nextValue,
      },
    }))
    setErrorMessage('')
    setIsSavingEmotionVisualizationEnabled(true)
    try {
      const updatedGame = await updateStoryGameSettings({
        token: authToken,
        gameId: targetGameId,
        emotionVisualizationEnabled: nextValue,
        contextLimitTokens: contextLimitChars,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: previousShowNpcThoughts,
        ambientEnabled: previousAmbientEnabled,
      })
      setEmotionVisualizationEnabled(nextValue)
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
                  ambient_enabled: previousAmbientEnabled,
                  emotion_visualization_enabled: nextValue,
                }
              : game,
          ),
        ),
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить визуализацию эмоций'
      setErrorMessage(detail)
    } finally {
      setIsSavingEmotionVisualizationEnabled(false)
    }
  }, [
    activeGameId,
    ambientEnabled,
    authToken,
    contextLimitChars,
    emotionVisualizationEnabled,
    isAdministrator,
    isGenerating,
    isSavingAmbientEnabled,
    isSavingContextLimit,
    isSavingEmotionVisualizationEnabled,
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

  const toggleCanonicalStatePipelineEnabled = useCallback(async () => {
    const targetGameId = activeGameId
    if (
      !isAdministrator ||
      !targetGameId ||
      isSavingCanonicalStatePipeline ||
      isSavingCanonicalStateSafeFallback ||
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

    const nextValue = !canonicalStatePipelineEnabled
    const previousValue = canonicalStatePipelineEnabled
    const previousSafeFallback = canonicalStateSafeFallbackEnabled
    const previousStoryLlmModel = storyLlmModel
    const previousMemoryOptimization = memoryOptimizationEnabled
    const previousStoryTopK = storyTopK
    const previousStoryTopR = storyTopR
    const previousShowGgThoughts = showGgThoughts
    const previousShowNpcThoughts = showNpcThoughts
    const previousAmbientEnabled = ambientEnabled
    const previousResponseMaxTokens = responseMaxTokens
    const previousResponseMaxTokensEnabled = responseMaxTokensEnabled

    setCanonicalStatePipelineEnabled(nextValue)
    setStorySettingsOverrides((previousOverrides) => ({
      ...previousOverrides,
      [targetGameId]: {
        ...previousOverrides[targetGameId],
        storyLlmModel: previousStoryLlmModel,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        memoryOptimizationMode,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: previousShowNpcThoughts,
        ambientEnabled: previousAmbientEnabled,
        canonicalStatePipelineEnabled: nextValue,
        canonicalStateSafeFallbackEnabled: previousSafeFallback,
      },
    }))
    setErrorMessage('')
    setIsSavingCanonicalStatePipeline(true)
    try {
      const updatedGame = await updateStoryGameSettings({
        token: authToken,
        gameId: targetGameId,
        canonicalStatePipelineEnabled: nextValue,
        contextLimitTokens: contextLimitChars,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: previousShowNpcThoughts,
        ambientEnabled: previousAmbientEnabled,
      })
      setCanonicalStatePipelineEnabled(nextValue)
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
                  ambient_enabled: previousAmbientEnabled,
                  canonical_state_pipeline_enabled: nextValue,
                  canonical_state_safe_fallback_enabled: previousSafeFallback,
                }
              : game,
          ),
        ),
      )
    } catch (error) {
      setCanonicalStatePipelineEnabled(previousValue)
      setStorySettingsOverrides((previousOverrides) => ({
        ...previousOverrides,
        [targetGameId]: {
          ...previousOverrides[targetGameId],
          storyLlmModel: previousStoryLlmModel,
          responseMaxTokens: previousResponseMaxTokens,
          responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
          memoryOptimizationEnabled: previousMemoryOptimization,
          memoryOptimizationMode,
          storyTopK: previousStoryTopK,
          storyTopR: previousStoryTopR,
          showGgThoughts: previousShowGgThoughts,
          showNpcThoughts: previousShowNpcThoughts,
          ambientEnabled: previousAmbientEnabled,
          canonicalStatePipelineEnabled: previousValue,
          canonicalStateSafeFallbackEnabled: previousSafeFallback,
        },
      }))
      const detail = error instanceof Error ? error.message : 'Не удалось обновить RPG pipeline'
      setErrorMessage(detail)
    } finally {
      setIsSavingCanonicalStatePipeline(false)
    }
  }, [
    activeGameId,
    ambientEnabled,
    authToken,
    canonicalStatePipelineEnabled,
    canonicalStateSafeFallbackEnabled,
    contextLimitChars,
    isAdministrator,
    isGenerating,
    isSavingAmbientEnabled,
    isSavingCanonicalStatePipeline,
    isSavingCanonicalStateSafeFallback,
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

  const toggleCanonicalStateSafeFallbackEnabled = useCallback(async () => {
    const targetGameId = activeGameId
    if (
      !isAdministrator ||
      !targetGameId ||
      !canonicalStatePipelineEnabled ||
      isSavingCanonicalStateSafeFallback ||
      isSavingCanonicalStatePipeline ||
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

    const nextValue = !canonicalStateSafeFallbackEnabled
    const previousValue = canonicalStateSafeFallbackEnabled
    const previousPipelineEnabled = canonicalStatePipelineEnabled
    const previousStoryLlmModel = storyLlmModel
    const previousMemoryOptimization = memoryOptimizationEnabled
    const previousStoryTopK = storyTopK
    const previousStoryTopR = storyTopR
    const previousShowGgThoughts = showGgThoughts
    const previousShowNpcThoughts = showNpcThoughts
    const previousAmbientEnabled = ambientEnabled
    const previousResponseMaxTokens = responseMaxTokens
    const previousResponseMaxTokensEnabled = responseMaxTokensEnabled

    setCanonicalStateSafeFallbackEnabled(nextValue)
    setStorySettingsOverrides((previousOverrides) => ({
      ...previousOverrides,
      [targetGameId]: {
        ...previousOverrides[targetGameId],
        storyLlmModel: previousStoryLlmModel,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        memoryOptimizationMode,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: previousShowNpcThoughts,
        ambientEnabled: previousAmbientEnabled,
        canonicalStatePipelineEnabled: previousPipelineEnabled,
        canonicalStateSafeFallbackEnabled: nextValue,
      },
    }))
    setErrorMessage('')
    setIsSavingCanonicalStateSafeFallback(true)
    try {
      const updatedGame = await updateStoryGameSettings({
        token: authToken,
        gameId: targetGameId,
        canonicalStateSafeFallbackEnabled: nextValue,
        contextLimitTokens: contextLimitChars,
        responseMaxTokens: previousResponseMaxTokens,
        responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
        memoryOptimizationEnabled: previousMemoryOptimization,
        storyTopK: previousStoryTopK,
        storyTopR: previousStoryTopR,
        showGgThoughts: previousShowGgThoughts,
        showNpcThoughts: previousShowNpcThoughts,
        ambientEnabled: previousAmbientEnabled,
      })
      setCanonicalStateSafeFallbackEnabled(nextValue)
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
                  ambient_enabled: previousAmbientEnabled,
                  canonical_state_pipeline_enabled: previousPipelineEnabled,
                  canonical_state_safe_fallback_enabled: nextValue,
                }
              : game,
          ),
        ),
      )
    } catch (error) {
      setCanonicalStateSafeFallbackEnabled(previousValue)
      setStorySettingsOverrides((previousOverrides) => ({
        ...previousOverrides,
        [targetGameId]: {
          ...previousOverrides[targetGameId],
          storyLlmModel: previousStoryLlmModel,
          responseMaxTokens: previousResponseMaxTokens,
          responseMaxTokensEnabled: previousResponseMaxTokensEnabled,
          memoryOptimizationEnabled: previousMemoryOptimization,
          memoryOptimizationMode,
          storyTopK: previousStoryTopK,
          storyTopR: previousStoryTopR,
          showGgThoughts: previousShowGgThoughts,
          showNpcThoughts: previousShowNpcThoughts,
          ambientEnabled: previousAmbientEnabled,
          canonicalStatePipelineEnabled: previousPipelineEnabled,
          canonicalStateSafeFallbackEnabled: previousValue,
        },
      }))
      const detail = error instanceof Error ? error.message : 'Не удалось обновить safe fallback'
      setErrorMessage(detail)
    } finally {
      setIsSavingCanonicalStateSafeFallback(false)
    }
  }, [
    activeGameId,
    ambientEnabled,
    authToken,
    canonicalStatePipelineEnabled,
    canonicalStateSafeFallbackEnabled,
    contextLimitChars,
    isAdministrator,
    isGenerating,
    isSavingAmbientEnabled,
    isSavingCanonicalStatePipeline,
    isSavingCanonicalStateSafeFallback,
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
        ...previousOverrides[targetGameId],
        storyLlmModel: previousStoryLlmModel,
        responseMaxTokens: normalizedResponseMaxTokens,
        responseMaxTokensEnabled: nextValue,
        memoryOptimizationEnabled: previousMemoryOptimization,
        memoryOptimizationMode,
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
    async (nextTemperature: number, nextRepetitionPenalty: number, nextTopK: number, nextTopR: number) => {
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
      const normalizedRepetitionPenalty = clampStoryRepetitionPenalty(nextRepetitionPenalty)
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
      setStoryRepetitionPenalty(normalizedRepetitionPenalty)
      setStoryRepetitionPenaltyDraft(normalizedRepetitionPenalty.toFixed(2))
      setStoryTopK(normalizedTopK)
      setStoryTopR(normalizedTopR)
      setStorySettingsOverrides((previousOverrides) => ({
        ...previousOverrides,
        [targetGameId]: {
          ...previousOverrides[targetGameId],
          storyLlmModel: normalizedStoryModel,
          responseMaxTokens: normalizedResponseMaxTokens,
          responseMaxTokensEnabled: normalizedResponseMaxTokensEnabled,
          memoryOptimizationEnabled: normalizedMemoryOptimization,
          memoryOptimizationMode,
          storyRepetitionPenalty: normalizedRepetitionPenalty,
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
          storyRepetitionPenalty: normalizedRepetitionPenalty,
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
                    story_repetition_penalty: normalizedRepetitionPenalty,
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

  const handleStoryRepetitionPenaltySliderChange = useCallback((_event: Event, nextValue: number | number[]) => {
    const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
    const normalizedValue = clampStoryRepetitionPenalty(rawValue)
    setStoryRepetitionPenalty(normalizedValue)
    setStoryRepetitionPenaltyDraft(normalizedValue.toFixed(2))
  }, [])

  const handleStoryRepetitionPenaltySliderCommit = useCallback(
    async (_event: unknown, nextValue: number | number[]) => {
      const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
      await persistStorySamplingSettings(storyTemperature, rawValue, storyTopK, storyTopR)
    },
    [persistStorySamplingSettings, storyTemperature, storyTopK, storyTopR],
  )

  const handleStoryRepetitionPenaltyDraftChange = useCallback((value: string) => {
    const sanitized = value
      .replace(',', '.')
      .replace(/[^0-9.]/g, '')
      .replace(/^(\d*\.?\d*).*$/, '$1')
      .slice(0, 4)
    setStoryRepetitionPenaltyDraft(sanitized)
    if (!sanitized) {
      return
    }
    const parsed = Number.parseFloat(sanitized)
    if (Number.isNaN(parsed)) {
      return
    }
    setStoryRepetitionPenalty(clampStoryRepetitionPenalty(parsed))
  }, [])

  const handleStoryRepetitionPenaltyDraftCommit = useCallback(async () => {
    const parsed = Number.parseFloat(storyRepetitionPenaltyDraft.replace(',', '.'))
    const normalizedValue = clampStoryRepetitionPenalty(Number.isNaN(parsed) ? storyRepetitionPenalty : parsed)
    setStoryRepetitionPenalty(normalizedValue)
    setStoryRepetitionPenaltyDraft(normalizedValue.toFixed(2))
    await persistStorySamplingSettings(storyTemperature, normalizedValue, storyTopK, storyTopR)
  }, [
    persistStorySamplingSettings,
    storyRepetitionPenaltyDraft,
    storyRepetitionPenalty,
    storyTemperature,
    storyTopK,
    storyTopR,
  ])

  const handleStoryTemperatureSliderCommit = useCallback(
    async (_event: unknown, nextValue: number | number[]) => {
      const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
      await persistStorySamplingSettings(rawValue, storyRepetitionPenalty, storyTopK, storyTopR)
    },
    [persistStorySamplingSettings, storyRepetitionPenalty, storyTopK, storyTopR],
  )

  const handleStoryTopKSliderChange = useCallback((_event: Event, nextValue: number | number[]) => {
    const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
    setStoryTopK(clampStoryTopK(rawValue))
  }, [])

  const handleStoryTopKSliderCommit = useCallback(
    async (_event: unknown, nextValue: number | number[]) => {
      const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
      await persistStorySamplingSettings(storyTemperature, storyRepetitionPenalty, rawValue, storyTopR)
    },
    [persistStorySamplingSettings, storyRepetitionPenalty, storyTemperature, storyTopR],
  )

  const handleStoryTopRSliderChange = useCallback((_event: Event, nextValue: number | number[]) => {
    const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
    setStoryTopR(clampStoryTopR(rawValue))
  }, [])

  const handleStoryTopRSliderCommit = useCallback(
    async (_event: unknown, nextValue: number | number[]) => {
      const rawValue = Array.isArray(nextValue) ? nextValue[0] : nextValue
      await persistStorySamplingSettings(storyTemperature, storyRepetitionPenalty, storyTopK, rawValue)
    },
    [persistStorySamplingSettings, storyRepetitionPenalty, storyTemperature, storyTopK],
  )

  const handleResetStorySampling = useCallback(async () => {
    await persistStorySamplingSettings(
      selectedNarratorSamplingDefaults.storyTemperature,
      selectedNarratorSamplingDefaults.storyRepetitionPenalty,
      selectedNarratorSamplingDefaults.storyTopK,
      selectedNarratorSamplingDefaults.storyTopR,
    )
  }, [persistStorySamplingSettings, selectedNarratorSamplingDefaults])

  const handleOpenBugReportDialog = useCallback(() => {
    if (!activeGameId || isCreatingGame || isGenerating) {
      return
    }
    setIsComposerAiMenuOpen(false)
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
    if (!activeGameId || !currentRerollAssistantMessage || isStoryTurnBusy || isCreatingGame || isUndoingAssistantStep) {
      return
    }
    setIsComposerAiMenuOpen(false)
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
    isStoryTurnBusy,
    isUndoingAssistantStep,
  ])

  useEffect(() => {
    if (isCreatingGame || isStoryTurnBusy || isUndoingAssistantStep) {
      setIsComposerAiMenuOpen(false)
    }
  }, [isCreatingGame, isStoryTurnBusy, isUndoingAssistantStep])

  useEffect(() => {
    if (!isComposerAiMenuOpen) {
      return
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsComposerAiMenuOpen(false)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isComposerAiMenuOpen])

  useEffect(() => {
    if (!isComposerAiMenuOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      const clickedButton = composerAiButtonRef.current?.contains(target) ?? false
      const clickedMenu = composerAiMenuRef.current?.contains(target) ?? false
      if (clickedButton || clickedMenu) {
        return
      }

      setIsComposerAiMenuOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isComposerAiMenuOpen])

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
      smartRegenerationMode?: SmartRegenerationMode
      smartRegenerationOptions?: SmartRegenerationOption[]
      instructionCards?: StoryInstructionCard[]
    }) => {
      setIsAutoScrollPaused(false)
      setErrorMessage('')
      setIsGenerating(true)
      setIsFinalizingStoryTurn(false)
      setActiveAssistantMessageId(null)
      const controller = new AbortController()
      generationAbortRef.current = controller
      let wasAborted = false
      let streamStarted = false
      let generationFailed = false
      let postprocessPending = false
      let startedAssistantMessageId: number | null = null
      let completedAssistantMessageId: number | null = null
      const completedPayloadRef: { current: StoryStreamDonePayload | null } = { current: null }
      const smoothStreamingControllerRef: { current: SmoothStreamingTextController | null } = { current: null }

      const updateAssistantMessageContent = (messageId: number, content: string) => {
        const now = new Date().toISOString()
        setMessages((previousMessages) => {
          const targetIndex = previousMessages.findIndex((message) => message.id === messageId)
          if (targetIndex < 0) {
            return previousMessages
          }
          const nextMessages = [...previousMessages]
          nextMessages[targetIndex] = {
            ...nextMessages[targetIndex],
            content,
            updated_at: now,
          }
          return nextMessages
        })
      }

      const appendAssistantMessageDelta = (messageId: number, delta: string) => {
        const now = new Date().toISOString()
        setMessages((previousMessages) => {
          const targetIndex = previousMessages.findIndex((message) => message.id === messageId)
          if (targetIndex < 0) {
            return previousMessages
          }
          const nextMessages = [...previousMessages]
          const targetMessage = nextMessages[targetIndex]
          nextMessages[targetIndex] = {
            ...targetMessage,
            content: `${targetMessage.content}${delta}`,
            updated_at: now,
          }
          return nextMessages
        })
      }

      const commitCompletedAssistantMessage = (payload: StoryStreamDonePayload) => {
        setMessages((previousMessages) => {
          const targetIndex = previousMessages.findIndex((message) => message.id === payload.message.id)
          if (targetIndex < 0) {
            return previousMessages
          }
          const nextMessages = [...previousMessages]
          nextMessages[targetIndex] = normalizeStoryMessageItem(payload.message)
          return nextMessages
        })
      }

      try {
        await generateStoryResponseStream({
          token: authToken,
          gameId: options.gameId,
          prompt: options.prompt,
          rerollLastResponse: options.rerollLastResponse,
          discardLastAssistantSteps: options.discardLastAssistantSteps,
          smartRegeneration: options.smartRegenerationOptions?.length
            ? {
                enabled: true,
                mode: options.smartRegenerationMode ?? DEFAULT_SMART_REGENERATION_MODE,
                options: options.smartRegenerationOptions,
              }
            : undefined,
          instructions: (options.instructionCards ?? [])
            .filter((card) => card.is_active !== false)
            .map((card) => ({
              title: toStoryText(card.title).replace(/\s+/g, ' ').trim(),
              content: replaceMainHeroInlineTags(toStoryText(card.content).replace(/\r\n/g, '\n').trim(), mainHeroDisplayNameForTags),
            }))
            .filter((card) => card.title.length > 0 && card.content.length > 0),
          storyLlmModel,
          responseMaxTokens: responseMaxTokensEnabled ? responseMaxTokens : undefined,
          memoryOptimizationEnabled,
          storyTemperature,
          storyRepetitionPenalty,
          storyTopK,
          storyTopR,
          showGgThoughts,
          showNpcThoughts,
          ambientEnabled,
          environmentEnabled: environmentTimeEnabled || environmentWeatherEnabled,
          emotionVisualizationEnabled: isAdministrator ? emotionVisualizationEnabled : false,
          signal: controller.signal,
          onStart: (payload) => {
            streamStarted = true
            if (options.rerollLastResponse || (options.discardLastAssistantSteps ?? 0) > 0) {
              setIsRerollTurnPendingReplacement(false)
            }
            startedAssistantMessageId = payload.assistant_message_id
            setActiveAssistantMessageId(payload.assistant_message_id)
            smoothStreamingControllerRef.current = createSmoothStreamingTextController({
              enabled: smoothStreamingEnabled,
              reducedMotion: prefersReducedMotion(),
              onUpdate: (text) => updateAssistantMessageContent(payload.assistant_message_id, text),
            })
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
            if (smoothStreamingControllerRef.current) {
              smoothStreamingControllerRef.current.appendChunk(payload.delta)
              return
            }
            appendAssistantMessageDelta(payload.assistant_message_id, payload.delta)
          },
          onPlotMemory: (payload) => {
            const nextPlotEvents = payload.plot_card_events ?? []
            const nextPlotCards = payload.plot_cards ?? null
            const nextAiMemoryBlocks = payload.ai_memory_blocks ?? null
            if (nextPlotCards !== null) {
              setPlotCards(normalizeStoryPlotCards(nextPlotCards))
            } else if (nextPlotEvents.length > 0) {
              setPlotCards((previousCards) => reapplyPlotCardsByEvents(previousCards, nextPlotEvents, options.gameId))
            }
            if (nextAiMemoryBlocks !== null) {
              setAiMemoryBlocks(normalizeStoryMemoryBlocks(nextAiMemoryBlocks))
            }
            applyPlotCardEvents(nextPlotEvents)
          },
          onDone: (payload) => {
            completedPayloadRef.current = payload
            completedAssistantMessageId = payload.message.id
            if (payload.user) {
              onUserUpdate(payload.user)
            }
            if (payload.game) {
              setActiveGameSummary(payload.game)
              setGames((previousGames) =>
                sortGamesByActivity(
                  previousGames.map((game) => (game.id === payload.game!.id ? payload.game! : game)),
                ),
              )
            }
            postprocessPending = Boolean(payload.postprocess_pending)
            const nextPlotEvents = payload.plot_card_events ?? []
            const nextWorldEvents = payload.world_card_events ?? []
            const nextPlotCards = payload.plot_cards ?? null
            const nextAiMemoryBlocks = payload.ai_memory_blocks ?? null
            const nextWorldCards = payload.world_cards ?? null
            if (nextPlotCards !== null) {
              setPlotCards(normalizeStoryPlotCards(nextPlotCards))
            } else if (nextPlotEvents.length > 0) {
              setPlotCards((previousCards) => reapplyPlotCardsByEvents(previousCards, nextPlotEvents, options.gameId))
            }
            if (nextAiMemoryBlocks !== null) {
              setAiMemoryBlocks(normalizeStoryMemoryBlocks(nextAiMemoryBlocks))
            }
            if (nextWorldCards !== null) {
              setWorldCards(normalizeStoryWorldCards(nextWorldCards))
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
          },
        })
        const completedPayload = completedPayloadRef.current
        if (completedPayload) {
          const normalizedCompletedMessage = normalizeStoryMessageItem(completedPayload.message)
          if (smoothStreamingControllerRef.current) {
            smoothStreamingControllerRef.current.appendFinalText(normalizedCompletedMessage.content)
            await smoothStreamingControllerRef.current.finish()
          } else {
            updateAssistantMessageContent(normalizedCompletedMessage.id, normalizedCompletedMessage.content)
          }
          commitCompletedAssistantMessage(completedPayload)
        }
      } catch (error) {
        smoothStreamingControllerRef.current?.cancel()
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
        if ((options.rerollLastResponse || (options.discardLastAssistantSteps ?? 0) > 0) && !streamStarted) {
          setIsRerollTurnPendingReplacement(false)
        }
        setIsFinalizingStoryTurn(true)
        setIsGenerating(false)
        setActiveAssistantMessageId(null)
        generationAbortRef.current = null
        if (!completedPayloadRef.current) {
          smoothStreamingControllerRef.current?.cancel()
        }

        if (wasAborted && streamStarted) {
          await new Promise<void>((resolve) => {
            window.setTimeout(() => resolve(), 700)
          })
        }

        const shouldOptimizeStoryMemory =
          !generationFailed &&
          !wasAborted &&
          streamStarted &&
          completedAssistantMessageId !== null
        const shouldReloadGameSnapshot =
          generationFailed ||
          wasAborted ||
          !streamStarted ||
          completedAssistantMessageId === null
        const minimumExpectedAssistantMessageId = completedAssistantMessageId ?? startedAssistantMessageId
        const shouldRefreshGameList = true
        const shouldRetryGameSyncWithoutDoneEvent =
          !wasAborted && streamStarted && startedAssistantMessageId !== null && completedAssistantMessageId === null
        const shouldReconcileSuccessfulGeneration =
          !generationFailed &&
          !wasAborted &&
          streamStarted &&
          completedAssistantMessageId !== null &&
          !postprocessPending
        const shouldPollPostprocessInBackground = postprocessPending
        const canContinueDeferredTurnSync = () =>
          activeGameIdRef.current === options.gameId && generationAbortRef.current === null

        if (shouldReloadGameSnapshot) {
          try {
            await loadGameById(options.gameId, {
              silent: true,
              minAssistantMessageId: minimumExpectedAssistantMessageId,
            })
          } catch (syncError) {
            console.error('Failed to reload story snapshot after generation', syncError)
          }
        }

        setIsFinalizingStoryTurn(false)

        if (
          shouldOptimizeStoryMemory ||
          shouldRefreshGameList ||
          shouldRetryGameSyncWithoutDoneEvent ||
          shouldReconcileSuccessfulGeneration ||
          shouldPollPostprocessInBackground
        ) {
          void (async () => {
            if (shouldOptimizeStoryMemory && canContinueDeferredTurnSync()) {
              pendingContextBudgetCheckRef.current = true
              try {
                await optimizeStoryMemorySnapshot(options.gameId, completedAssistantMessageId)
              } catch (memoryError) {
                console.error('Story memory optimize after generation failed', memoryError)
                const detail = memoryError instanceof Error ? memoryError.message : 'Ход создан, но оптимизация памяти не выполнена'
                setErrorMessage(detail)
              }
            }

            if (shouldRefreshGameList && canContinueDeferredTurnSync()) {
              try {
                const refreshedGames = await listStoryGames(authToken, { compact: true })
                if (canContinueDeferredTurnSync()) {
                  setGames(sortGamesByActivity(refreshedGames))
                }
              } catch {
                // Keep current games if refresh failed.
              }
            }

            if (shouldRetryGameSyncWithoutDoneEvent) {
              const retryAttempts = 2
              for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
                await new Promise<void>((resolve) => {
                  window.setTimeout(resolve, 800)
                })
                if (!canContinueDeferredTurnSync()) {
                  break
                }
                await loadGameById(options.gameId, {
                  silent: true,
                  minAssistantMessageId: minimumExpectedAssistantMessageId,
                })
              }
            }

            if (shouldReconcileSuccessfulGeneration) {
              const reconcileDelaysMs = [450, 1400]
              for (const delayMs of reconcileDelaysMs) {
                await new Promise<void>((resolve) => {
                  window.setTimeout(resolve, delayMs)
                })
                if (!canContinueDeferredTurnSync()) {
                  break
                }
                const refreshed = await loadGameById(options.gameId, {
                  silent: true,
                  suppressErrors: true,
                  minAssistantMessageId: completedAssistantMessageId,
                })
                if (refreshed) {
                  break
                }
              }
            }

            if (shouldPollPostprocessInBackground) {
              const maxAttempts = 20
              const delayMs = 3000
              for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                await new Promise<void>((resolve) => {
                  window.setTimeout(resolve, delayMs)
                })
                if (!canContinueDeferredTurnSync()) {
                  break
                }
                try {
                  await loadGameById(options.gameId, {
                    silent: true,
                    minAssistantMessageId: minimumExpectedAssistantMessageId,
                  })
                  const refreshedGames = await listStoryGames(authToken, { compact: true })
                  if (canContinueDeferredTurnSync()) {
                    setGames(sortGamesByActivity(refreshedGames))
                  }
                } catch {
                  // Ignore background sync errors; next attempt may succeed.
                }
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
      environmentTimeEnabled,
      environmentWeatherEnabled,
      authToken,
      emotionVisualizationEnabled,
      isAdministrator,
      loadGameById,
      memoryOptimizationEnabled,
      onUserUpdate,
      optimizeStoryMemorySnapshot,
      responseMaxTokensEnabled,
      responseMaxTokens,
      showGgThoughts,
      showNpcThoughts,
      smoothStreamingEnabled,
      mainHeroDisplayNameForTags,
      storyLlmModel,
      storyRepetitionPenalty,
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
    async (
      rawPrompt: string,
      options?: {
        clearComposer?: boolean
        hideUserMessage?: boolean
        discardLastAssistantSteps?: number
        smartRegenerationMode?: SmartRegenerationMode
        smartRegenerationOptions?: SmartRegenerationOption[]
      },
    ) => {
      if (isStoryTurnBusy) {
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
        discardLastAssistantSteps: options?.discardLastAssistantSteps,
        smartRegenerationMode: options?.smartRegenerationMode,
        smartRegenerationOptions: options?.smartRegenerationOptions,
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
      isStoryTurnBusy,
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

    if (isStoryTurnBusy) {
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
    setIsComposerAiMenuOpen(false)
    await runStoryGeneration({
      gameId: targetGameId,
      prompt: normalizedPrompt,
      instructionCards,
    })
  }, [activeGameId, applyPlotCardEvents, applyStoryGameSettings, applyWorldCardEvents, authToken, currentTurnCostTokens, hasInsufficientTokensForTurn, inputValue, instructionCards, isStoryTurnBusy, isVoiceInputActive, onNavigate, runStoryGeneration])

  const handleContinueStory = useCallback(
    async (assistantMessageId: number) => {
      if (isStoryTurnBusy || isCreatingGame) {
        return
      }
      setIsComposerAiMenuOpen(false)
      setContinueHiddenForMessageId(assistantMessageId)
      const generationResult = await sendStoryPrompt(STORY_CONTINUE_PROMPT, { hideUserMessage: true })
      if (!generationResult?.streamStarted) {
        setContinueHiddenForMessageId(null)
      }
    },
    [isCreatingGame, isStoryTurnBusy, sendStoryPrompt],
  )

  const handleContinueLatestTurn = useCallback(() => {
    if (!currentRerollAssistantMessage) {
      return
    }
    void handleContinueStory(currentRerollAssistantMessage.id)
  }, [currentRerollAssistantMessage, handleContinueStory])

  const handleToggleComposerAiMenu = useCallback(() => {
    setIsComposerAiMenuOpen((previousState) => !previousState)
  }, [])

  const handleToggleEnvironmentEnabled = useCallback(
    async (nextEnabled: boolean) => {
      if (!activeGameId || isSavingEnvironmentPanel || isRegeneratingEnvironmentWeather) {
        return
      }

      setIsSavingEnvironmentPanel(true)
      setErrorMessage('')
      try {
        const updatedGame = await updateStoryGameSettings({
          token: authToken,
          gameId: activeGameId,
          environmentEnabled: nextEnabled || environmentWeatherEnabled,
          environmentTimeEnabled: nextEnabled,
          environmentWeatherEnabled,
          environmentCurrentDatetime: activeGameSummary?.environment_current_datetime ?? null,
          environmentCurrentWeather: activeGameSummary?.environment_current_weather ?? null,
          environmentTomorrowWeather: activeGameSummary?.environment_tomorrow_weather ?? null,
          currentLocationLabel: activeGameSummary?.current_location_label ?? null,
        })
        applyUpdatedGameSummary(updatedGame)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить настройки времени'
        setErrorMessage(detail)
      } finally {
        setIsSavingEnvironmentPanel(false)
      }
    },
    [
      activeGameId,
      activeGameSummary,
      applyUpdatedGameSummary,
      authToken,
      environmentWeatherEnabled,
      isRegeneratingEnvironmentWeather,
      isSavingEnvironmentPanel,
    ],
  )

  const handleToggleEnvironmentWeatherEnabled = useCallback(
    async (nextEnabled: boolean) => {
      if (!activeGameId || isSavingEnvironmentPanel || isRegeneratingEnvironmentWeather) {
        return
      }

      setIsSavingEnvironmentPanel(true)
      setErrorMessage('')
      try {
        const updatedGame = await updateStoryGameSettings({
          token: authToken,
          gameId: activeGameId,
          environmentEnabled: environmentTimeEnabled || nextEnabled,
          environmentTimeEnabled,
          environmentWeatherEnabled: nextEnabled,
          environmentCurrentDatetime: activeGameSummary?.environment_current_datetime ?? null,
          environmentCurrentWeather: activeGameSummary?.environment_current_weather ?? null,
          environmentTomorrowWeather: activeGameSummary?.environment_tomorrow_weather ?? null,
          currentLocationLabel: activeGameSummary?.current_location_label ?? null,
        })
        applyUpdatedGameSummary(updatedGame)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить настройки погоды'
        setErrorMessage(detail)
      } finally {
        setIsSavingEnvironmentPanel(false)
      }
    },
    [
      activeGameId,
      activeGameSummary,
      applyUpdatedGameSummary,
      authToken,
      environmentTimeEnabled,
      isRegeneratingEnvironmentWeather,
      isSavingEnvironmentPanel,
    ],
  )

  const handleRegenerateEnvironmentWeather = useCallback(async () => {
    if (
      !activeGameId
      || isSavingEnvironmentPanel
      || isRegeneratingEnvironmentWeather
      || !environmentWeatherEnabled
    ) {
      return
    }

    setIsRegeneratingEnvironmentWeather(true)
    setErrorMessage('')
    try {
      const updatedGame = await regenerateStoryEnvironmentWeather({
        token: authToken,
        gameId: activeGameId,
      })
      applyUpdatedGameSummary(updatedGame)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось перегенерировать погоду'
      setErrorMessage(detail)
    } finally {
      setIsRegeneratingEnvironmentWeather(false)
    }
  }, [
    activeGameId,
    applyUpdatedGameSummary,
    authToken,
    environmentWeatherEnabled,
    isRegeneratingEnvironmentWeather,
    isSavingEnvironmentPanel,
  ])

  const handleSaveEnvironmentEditor = useCallback(async () => {
    if (!activeGameId || isSavingEnvironmentPanel || isRegeneratingEnvironmentWeather) {
      return
    }

    const nextCurrentWeather = {
      ...(activeGameSummary?.environment_current_weather ?? {}),
      summary: environmentCurrentSummaryDraft.trim(),
      season: resolveEnvironmentSeasonLabelByValue(environmentSeasonDraft).toLowerCase(),
      month: resolveEnvironmentMonthLabel(environmentMonthDraft).toLowerCase(),
      timeline: createDefaultEnvironmentTimeline().map((entry) => ({
        start_time: readEnvironmentString(entry.start_time),
        end_time: readEnvironmentString(entry.end_time),
        summary: environmentCurrentSummaryDraft.trim(),
      })),
    }

    setIsSavingEnvironmentPanel(true)
    setErrorMessage('')
    try {
      const updatedGame = await updateStoryGameSettings({
        token: authToken,
        gameId: activeGameId,
        environmentEnabled: environmentTimeEnabled || environmentWeatherEnabled,
        environmentTimeEnabled,
        environmentWeatherEnabled,
        environmentCurrentDatetime: buildEnvironmentDateTimeFromDraft(
          activeGameSummary?.environment_current_datetime,
          environmentMonthDraft,
          environmentTimeDraft,
        ),
        environmentCurrentWeather: nextCurrentWeather,
        environmentTomorrowWeather: null,
        currentLocationLabel: environmentLocationDraft.trim() || null,
      })
      applyUpdatedGameSummary(updatedGame)
      setEnvironmentEditorOpen(false)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить время и погоду'
      setErrorMessage(detail)
    } finally {
      setIsSavingEnvironmentPanel(false)
    }
  }, [
    activeGameId,
    activeGameSummary,
    applyUpdatedGameSummary,
    authToken,
    environmentCurrentSummaryDraft,
    environmentLocationDraft,
    environmentMonthDraft,
    environmentSeasonDraft,
    environmentTimeDraft,
    environmentTimeEnabled,
    environmentWeatherEnabled,
    isRegeneratingEnvironmentWeather,
    isSavingEnvironmentPanel,
  ])

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

  const handleRerollLastResponse = useCallback(async (
    smartRegenerationOptions?: SmartRegenerationOption[],
    smartRegenerationMode?: SmartRegenerationMode,
  ) => {
    if (!canReroll || !activeGameId || !currentRerollAssistantMessage || !currentRerollSourceUserMessage) {
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

    const rerollAssistantMessage = currentRerollAssistantMessage
    const rerollSourceUserMessage = currentRerollSourceUserMessage
    setIsRerollTurnPendingReplacement(true)
    setMessages((previousMessages) =>
      previousMessages.filter(
        (message) => message.id !== rerollAssistantMessage.id && message.id !== rerollSourceUserMessage.id,
      ),
    )
    clearTurnImageEntries([rerollAssistantMessage.id])

    const generationResult = await sendStoryPrompt(rerollSourceUserMessage.content, {
      discardLastAssistantSteps: 1,
      smartRegenerationMode,
      smartRegenerationOptions,
    })
    if (generationResult === null) {
      setMessages((previousMessages) => {
        const restoredMessages = [...previousMessages]
        if (!restoredMessages.some((message) => message.id === rerollSourceUserMessage.id)) {
          restoredMessages.push(rerollSourceUserMessage)
        }
        if (!restoredMessages.some((message) => message.id === rerollAssistantMessage.id)) {
          restoredMessages.push(rerollAssistantMessage)
        }
        return restoredMessages.sort((left, right) => left.id - right.id)
      })
      setIsRerollTurnPendingReplacement(false)
    }
  }, [
    activeGameId,
    canReroll,
    clearTurnImageEntries,
    currentTurnCostTokens,
    currentRerollAssistantMessage,
    currentRerollSourceUserMessage,
    hasInsufficientTokensForTurn,
    sendStoryPrompt,
    setIsRerollTurnPendingReplacement,
  ])

  const handleRerollButtonClick = useCallback(() => {
    if (!canReroll) {
      return
    }
    if (advancedRegenerationEnabled) {
      setSelectedSmartRegenerationMode(DEFAULT_SMART_REGENERATION_MODE)
      setSelectedSmartRegenerationOptions(DEFAULT_SMART_REGENERATION_OPTIONS)
      setAdvancedRegenerationDialogOpen(true)
      return
    }
    void handleRerollLastResponse()
  }, [advancedRegenerationEnabled, canReroll, handleRerollLastResponse])

  const handleToggleSmartRegenerationOption = useCallback((option: SmartRegenerationOption) => {
    setSelectedSmartRegenerationOptions((currentOptions) =>
      resolveSmartRegenerationOptionSelection(currentOptions, option),
    )
  }, [])

  const handleDefaultRegenerationFromDialog = useCallback(() => {
    setAdvancedRegenerationDialogOpen(false)
    setSelectedSmartRegenerationMode(DEFAULT_SMART_REGENERATION_MODE)
    setSelectedSmartRegenerationOptions(DEFAULT_SMART_REGENERATION_OPTIONS)
    void handleRerollLastResponse()
  }, [handleRerollLastResponse])

  const handleSmartRegenerationFromDialog = useCallback(() => {
    const selectedOptions = selectedSmartRegenerationOptions.filter((option) => option !== 'preserve_format')
    if (!selectedOptions.length) {
      return
    }
    const payloadOptions = resolveSmartRegenerationOptionSelection(selectedOptions, 'preserve_format')
    const payloadMode = selectedSmartRegenerationMode
    setAdvancedRegenerationDialogOpen(false)
    setSelectedSmartRegenerationMode(DEFAULT_SMART_REGENERATION_MODE)
    setSelectedSmartRegenerationOptions(DEFAULT_SMART_REGENERATION_OPTIONS)
    void handleRerollLastResponse(payloadOptions, payloadMode)
  }, [handleRerollLastResponse, selectedSmartRegenerationMode, selectedSmartRegenerationOptions])

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
          setPaymentReferralBonusCoins(response.referral_bonus_granted ? Math.max(0, Math.trunc(response.referral_bonus_amount ?? 0)) : 0)
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
        mobileVariant="story"
        isPageMenuOpen={isPageMenuOpen}
        onTogglePageMenu={() => setIsPageMenuOpen((previous) => !previous)}
        onClosePageMenu={() => setIsPageMenuOpen(false)}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: false, onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', isActive: false, onClick: () => onNavigate('/games') },
          { key: 'games-publications', label: 'Публикации', isActive: false, onClick: () => onNavigate('/games/publications') },
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
        onOpenSettingsDialog={() => setProfileDialogOpen(true)}
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
              aria-label="Настройки ИИ"
              onClick={() => {
                setRightPanelMode('ai')
                setActiveAiPanelTab('settings')
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
            <HeaderAccountActions
              user={user}
              authToken={authToken}
              avatarSize={HEADER_AVATAR_SIZE}
              onOpenProfile={() => onNavigate('/profile')}
              showDailyRewards={false}
              hideAvatarBelowQuery="(max-width:499.95px)"
            />
          </Stack>
        }
      />

      {isMobileComposer && isRightPanelOpen ? (
        <Box
          onClick={() => setIsRightPanelOpen(false)}
          sx={{
            position: 'fixed',
            top: 'var(--morius-header-menu-top)',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 46,
            backgroundColor: 'rgba(1, 4, 8, 0.82)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
        />
      ) : null}

      <Box
        sx={{
          position: 'fixed',
          top: { xs: 'var(--morius-header-menu-top)', md: 'var(--morius-header-menu-top)' },
          left: 'auto',
          right: { xs: 0, md: 'var(--morius-interface-gap)' },
          bottom: { xs: 0, md: 'var(--morius-interface-gap)' },
          width: { xs: 'min(420px, 100vw)', md: rightPanelWidth },
          maxWidth: { xs: '100vw', md: 'none' },
          maxHeight: { xs: 'calc(100svh - var(--morius-header-menu-top))', md: 'none' },
          zIndex: 47,
          borderRadius: { xs: '26px 0 0 26px', md: 'var(--morius-radius)' },
          border: { xs: 'none', md: 'var(--morius-border-width) solid var(--morius-card-border)' },
          borderLeft: { xs: 'var(--morius-border-width) solid var(--morius-card-border)', md: 'none' },
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--morius-card-bg) 94%, #05070d 6%) 0%, color-mix(in srgb, var(--morius-card-bg) 88%, #020304 12%) 100%)',
          transform: {
            xs: isRightPanelOpen ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
            md: isRightPanelOpen ? 'translateX(0)' : 'translateX(calc(100% + var(--morius-interface-gap)))',
          },
          opacity: isRightPanelOpen ? 1 : 0,
          pointerEvents: isRightPanelOpen ? 'auto' : 'none',
          transition: 'transform 260ms ease, opacity 220ms ease',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: { xs: '-24px 0 48px rgba(0, 0, 0, 0.38)', md: '0 18px 40px rgba(0, 0, 0, 0.28)' },
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
        <Box
          sx={{
            px: { xs: 1.5, md: '10px' },
            pt: { xs: '16px', md: 'var(--morius-story-right-padding)' },
            borderBottom: 'var(--morius-border-width) solid var(--morius-card-border)',
          }}
        >
          <Box
            sx={{
              width: 42,
              height: 5,
              borderRadius: '999px',
              backgroundColor: 'color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
              mx: 'auto',
              mb: { xs: 0.7, md: 0 },
              display: 'none',
            }}
          />
          <Box
            data-tour-id="story-right-subtabs"
            sx={{
              display: 'grid',
              gridTemplateColumns: isRightPanelSecondTabVisible ? '1fr 1fr' : '1fr',
              alignItems: 'center',
              gap: 0.55,
              pb: 0.35,
            }}
          >
            <Button
              data-tour-id="story-right-subtab-primary"
              onClick={() =>
                rightPanelMode === 'ai'
                  ? setActiveAiPanelTab('settings')
                  : rightPanelMode === 'world'
                    ? setActiveWorldPanelTab('story')
                    : setActiveMemoryPanelTab('memory')
              }
              sx={{
                ...rightPanelTextTabButtonSx(isLeftPanelTabActive, rightPanelMode === 'world'),
                color:
                  rightPanelMode === 'world' && isLeftPanelTabActive
                    ? 'var(--morius-accent) !important'
                    : undefined,
                fontSize: 'var(--morius-body-size)',
                lineHeight: 1.1,
                textAlign: 'center',
                px: 1.4,
                py: 0.9,
                minHeight: 44,
                borderRadius: '12px',
              }}
            >
              {leftPanelTabLabel}
            </Button>
              {isRightPanelSecondTabVisible ? (
                <Button
                  data-tour-id="story-right-subtab-secondary"
                  onClick={() =>
                    rightPanelMode === 'world'
                      ? setActiveWorldPanelTab('world')
                      : setActiveMemoryPanelTab('dev')
                }
                sx={{
                  ...rightPanelTextTabButtonSx(!isLeftPanelTabActive, rightPanelMode === 'world'),
                  color:
                    rightPanelMode === 'world' && !isLeftPanelTabActive
                      ? 'var(--morius-accent) !important'
                      : undefined,
                  fontSize: 'var(--morius-body-size)',
                  lineHeight: 1.1,
                  textAlign: 'center',
                  px: 1.4,
                  py: 0.9,
                  minHeight: 44,
                  borderRadius: '12px',
                }}
              >
                {rightPanelTabLabel}
              </Button>
            ) : null}
          </Box>
          <Box
            sx={{
              display: 'none',
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
            px: { xs: 1.5, md: '10px' },
            py: { xs: 1.4, md: 'var(--morius-story-right-padding)' },
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

          {!shouldShowRightPanelLoadingSkeleton && rightPanelMode === 'world' && activeWorldPanelTab === 'story' ? (
            <Box data-tour-id="story-world-cards-panel" sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              <Box
                ref={cardsPanelTabsScrollerRef}
                className="morius-scrollbar"
                onPointerDown={handleCardsPanelTabsPointerDown}
                onPointerMove={handleCardsPanelTabsPointerMove}
                onPointerUp={handleCardsPanelTabsPointerEnd}
                onPointerCancel={handleCardsPanelTabsPointerEnd}
                sx={{
                  display: 'flex',
                  gap: 0.6,
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  touchAction: 'pan-x',
                  cursor: 'grab',
                  pr: 0.2,
                  '&::-webkit-scrollbar': {
                    display: 'none',
                  },
                  '&:active': {
                    cursor: 'grabbing',
                  },
                }}
              >
                {[
                  { key: 'characters' as const, label: 'Персонажи', iconMarkup: cardsCharactersTabIconMarkup },
                  { key: 'world' as const, label: 'Мир', iconMarkup: cardsWorldTabIconMarkup },
                  { key: 'instructions' as const, label: 'Правила', iconMarkup: cardsRulesTabIconMarkup },
                  { key: 'plot' as const, label: 'Сюжет', iconMarkup: cardsPlotTabIconMarkup },
                ].map((tab) => {
                  const isActive = cardsPanelTab === tab.key
                  return (
                    <Button
                      key={tab.key}
                      onClick={() => handleCardsPanelTabSelect(tab.key)}
                      sx={{
                        ...rightPanelTextTabButtonSx(isActive),
                        minHeight: 46,
                        px: 1.35,
                        borderRadius: '12px',
                        gap: 0.62,
                        fontSize: '12px',
                        letterSpacing: 0,
                        flexShrink: 0,
                        color: isActive ? 'var(--morius-accent) !important' : 'var(--morius-title-text) !important',
                      }}
                    >
                      <ThemedSvgIcon markup={tab.iconMarkup} size={18} sx={cardsPanelIconSx(isActive)} />
                      {tab.label}
                    </Button>
                  )
                })}
              </Box>

              <Box className="morius-scrollbar" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0 }}>
                {cardsPanelTab === 'characters' ? (
                  <Stack spacing={0.9}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minWidth: 0 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.16rem', fontWeight: 800 }}>Главный герой</Typography>
                      <ViewToggleButton cardsViewMode={cardsViewMode} setCardsViewMode={setCardsViewMode} />
                    </Stack>
                    {!mainHeroCard ? (
                      <RightPanelEmptyState
                        iconSrc={icons.world}
                        title="Герой не выбран"
                        description="Выберите главного героя, чтобы зафиксировать его внешность и роль в текущей истории."
                      />
                    ) : cardsViewMode === 'full' ? (
                      <Box sx={{ '&:hover .morius-overflow-action, &:focus-within .morius-overflow-action': { opacity: 1, pointerEvents: 'auto' } }}>
                        <CharacterShowcaseCard
                          title={mainHeroCard!.title}
                          description={replaceMainHeroInlineTags(mainHeroCard!.content, mainHeroDisplayNameForTags)}
                          imageUrl={mainHeroAvatarUrl}
                          imageScale={mainHeroCard!.avatar_scale}
                          hideFooter
                          descriptionLineClamp={4}
                          titleAccessory={characterStateEnabled ? renderWorldCardAiAccessBadge(mainHeroCard!) : null}
                          onClick={() => handleOpenEditWorldCardDialog(mainHeroCard!)}
                          actionSlot={
                            <IconButton
                              className="morius-overflow-action"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleOpenCardMenu(event, 'world', mainHeroCard!.id)
                              }}
                              disabled={isWorldCardActionLocked}
                              sx={overflowActionButtonSx}
                            >
                              <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>{'\u22EE'}</Box>
                            </IconButton>
                          }
                        />
                      </Box>
                    ) : (
                      <MobileCardItem
                        imageUrl={mainHeroAvatarUrl}
                        fallbackBackground={buildWorldFallbackArtwork(mainHeroCard!.id) as Record<string, unknown>}
                        title={mainHeroCard!.title}
                        description={replaceMainHeroInlineTags(mainHeroCard!.content, mainHeroDisplayNameForTags)}
                        showPlayButton={false}
                        onMenuClick={(e) => handleOpenCardMenu(e, 'world', mainHeroCard!.id)}
                        infoNode={characterStateEnabled ? renderWorldCardAiAccessBadge(mainHeroCard!) : undefined}
                        onClick={() => handleOpenEditWorldCardDialog(mainHeroCard!)}
                      />
                    )}

                    <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.08rem', fontWeight: 800, pt: 0.2 }}>Персонажи</Typography>
                    {displayedNpcCards.length === 0 ? (
                      <RightPanelEmptyState
                        iconSrc={icons.world}
                        title="NPC пока нет"
                        description="Добавляйте спутников, противников и важных персонажей, чтобы они сразу участвовали в истории."
                      />
                    ) : (
                      <>
                        {cardsViewMode === 'full' ? (
                          /* Full view: portrait CharacterShowcaseCards */
                          <Stack spacing={0.85}>
                            {displayedNpcCards.map((card) => {
                              const contextState = worldCardContextStateById.get(card.id)
                              const isCardContextActive = Boolean(contextState?.isActive)
                              const memoryTurnsLabelValue =
                                isCardContextActive &&
                                !contextState?.isAlwaysActive &&
                                typeof contextState?.turnsRemaining === 'number' &&
                                contextState.turnsRemaining > 0
                                  ? contextState.turnsRemaining
                                  : null

                              return (
                                <Box
                                  key={card.id}
                                  sx={{
                                    '&:hover .morius-overflow-action, &:focus-within .morius-overflow-action': { opacity: 1, pointerEvents: 'auto' },
                                    animation: isCardContextActive ? 'morius-npc-prioritize-enter 280ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
                                    '@keyframes morius-npc-prioritize-enter': {
                                      from: { opacity: 0.72, transform: 'translateY(10px)' },
                                      to: { opacity: 1, transform: 'translateY(0)' },
                                    },
                                  }}
                                >
                                  <CharacterShowcaseCard
                                    title={card.title}
                                    description={card.content}
                                    imageUrl={resolveWorldCardAvatar(card)}
                                    imageScale={card.avatar_scale}
                                    hideFooter
                                    highlighted={isCardContextActive}
                                    descriptionLineClamp={4}
                                    titleAccessory={
                                      (isCardContextActive && memoryTurnsLabelValue && memoryTurnsLabelValue > 0) || (characterStateEnabled && card.ai_edit_enabled) ? (
                                        <Stack direction="row" spacing={0.52} alignItems="center" sx={{ color: 'var(--morius-title-text)' }}>
                                          {isCardContextActive && memoryTurnsLabelValue && memoryTurnsLabelValue > 0 ? (
                                            <Stack direction="row" spacing={0.42} alignItems="center" sx={{ color: 'var(--morius-title-text)' }}>
                                              <Box component="img" src={clockMemoryIcon} alt="" sx={{ width: 14, height: 14, display: 'block', opacity: 0.94 }} />
                                              <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, lineHeight: 1 }}>
                                                {memoryTurnsLabelValue}
                                              </Typography>
                                            </Stack>
                                          ) : null}
                                          {characterStateEnabled ? renderWorldCardAiAccessBadge(card) : null}
                                        </Stack>
                                      ) : null
                                    }
                                    onClick={() => handleOpenEditWorldCardDialog(card)}
                                    actionSlot={
                                      <IconButton
                                        className="morius-overflow-action"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          handleOpenCardMenu(event, 'world', card.id)
                                        }}
                                        disabled={isWorldCardActionLocked}
                                        sx={overflowActionButtonSx}
                                      >
                                        <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>{'\u22EE'}</Box>
                                      </IconButton>
                                    }
                                  />
                                </Box>
                              )
                            })}
                          </Stack>
                        ) : (
                          /* Compact view: landscape MobileCardItem list */
                          <Stack spacing={1.2}>
                            {displayedNpcCards.map((card) => {
                              const contextState = worldCardContextStateById.get(card.id)
                              const isCardContextActive = Boolean(contextState?.isActive)
                              const memoryTurnsLabelValue =
                                isCardContextActive &&
                                !contextState?.isAlwaysActive &&
                                typeof contextState?.turnsRemaining === 'number' &&
                                contextState.turnsRemaining > 0
                                  ? contextState.turnsRemaining
                                  : null
                              return (
                                <MobileCardItem
                                  key={card.id}
                                  imageUrl={resolveApiResourceUrl(resolveWorldCardAvatar(card))}
                                  fallbackBackground={buildWorldFallbackArtwork(card.id) as Record<string, unknown>}
                                  title={card.title}
                                  description={card.content}
                                  isActive={isCardContextActive}
                                  showPlayButton={false}
                                  onMenuClick={(e) => handleOpenCardMenu(e, 'world', card.id)}
                                  infoNode={
                                    (isCardContextActive && memoryTurnsLabelValue) || (characterStateEnabled && card.ai_edit_enabled) ? (
                                      <Stack direction="row" spacing={0.6} alignItems="center">
                                        {isCardContextActive && memoryTurnsLabelValue ? (
                                          <Stack direction="row" spacing={0.3} alignItems="center">
                                            <Box component="img" src={clockMemoryIcon} alt="" sx={{ width: 13, height: 13, opacity: 0.9 }} />
                                            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--morius-text-secondary)', lineHeight: 1 }}>
                                              {memoryTurnsLabelValue}
                                            </Typography>
                                          </Stack>
                                        ) : null}
                                        {characterStateEnabled ? renderWorldCardAiAccessBadge(card) : null}
                                      </Stack>
                                    ) : undefined
                                  }
                                  onClick={() => handleOpenEditWorldCardDialog(card)}
                                />
                              )
                            })}
                          </Stack>
                        )}
                      </>
                    )}

                    {!mainHeroCard ? (
                      <Button
                        onClick={() => void handleOpenCharacterSelectorForMainHero()}
                        disabled={isGenerating || isCreatingGame}
                        sx={{ ...rightPanelCompactActionButtonSx, minHeight: 40 }}
                      >
                        Выбрать героя
                      </Button>
                    ) : null}
                    <Stack direction="row" spacing={0.65}>
                      <Button
                        onClick={() => handleOpenCreateWorldCardDialog('npc')}
                        disabled={isGenerating || isSavingWorldCard || deletingWorldCardId !== null || isCreatingGame}
                        sx={{ ...rightPanelCompactActionButtonSx, flex: 1, minHeight: 40 }}
                      >
                        Создать
                      </Button>
                      <Button
                        onClick={() => void handleOpenCharacterSelectorForNpc()}
                        disabled={isGenerating || isCreatingGame}
                        sx={{ ...rightPanelCompactActionButtonSx, flex: 1, minHeight: 40 }}
                      >
                        Из шаблона
                      </Button>
                    </Stack>
                  </Stack>
                ) : cardsPanelTab === 'world' ? (
                  <Stack spacing={0.9}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minWidth: 0 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.16rem', fontWeight: 800 }}>Описание мира</Typography>
                      <ViewToggleButton cardsViewMode={cardsViewMode} setCardsViewMode={setCardsViewMode} />
                    </Stack>
                    {!worldProfileCard ? (
                      <RightPanelEmptyState
                        iconSrc={icons.world}
                        title="Описание мира не задано"
                        description="Опишите лор, правила, атмосферу, расы и общий контекст мира. Эта карточка всегда остается в памяти рассказчика."
                      />
                    ) : cardsViewMode === 'full' ? (
                      <Box sx={{ '&:hover .morius-overflow-action, &:focus-within .morius-overflow-action': { opacity: 1, pointerEvents: 'auto' } }}>
                        <CharacterShowcaseCard
                          title={worldProfileCard.title}
                          description={replaceMainHeroInlineTags(worldProfileCard.content, mainHeroDisplayNameForTags)}
                          imageUrl={resolveWorldCardAvatar(worldProfileCard)}
                          imageScale={worldProfileCard.avatar_scale}
                          eyebrow="Описание мира"
                          footerHint="Всегда в памяти рассказчика"
                          descriptionLineClamp={5}
                          onClick={() => handleOpenEditWorldCardDialog(worldProfileCard)}
                          actionSlot={
                            <IconButton
                              className="morius-overflow-action"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleOpenCardMenu(event, 'world', worldProfileCard.id)
                              }}
                              disabled={isWorldCardActionLocked}
                              sx={overflowActionButtonSx}
                            >
                              <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>{'\u22EE'}</Box>
                            </IconButton>
                          }
                        />
                      </Box>
                    ) : (
                      <MobileCardItem
                        imageUrl={resolveWorldCardAvatar(worldProfileCard)}
                        fallbackBackground={buildWorldFallbackArtwork(worldProfileCard.id) as Record<string, unknown>}
                        title={worldProfileCard.title}
                        description={replaceMainHeroInlineTags(worldProfileCard.content, mainHeroDisplayNameForTags)}
                        showPlayButton={false}
                        onMenuClick={(e) => handleOpenCardMenu(e, 'world', worldProfileCard.id)}
                        onClick={() => handleOpenEditWorldCardDialog(worldProfileCard)}
                      />
                    )}

                    <Stack direction="row" spacing={0.65}>
                      <Button
                        onClick={() =>
                          worldProfileCard
                            ? handleOpenEditWorldCardDialog(worldProfileCard)
                            : handleOpenCreateWorldCardDialog('world_profile')
                        }
                        disabled={isGenerating || isSavingWorldCard || deletingWorldCardId !== null || isCreatingGame}
                        sx={{ ...rightPanelCompactActionButtonSx, flex: 1, minHeight: 40 }}
                      >
                        {worldProfileCard ? 'Редактировать' : 'Создать'}
                      </Button>
                      <Button
                        onClick={() => handleOpenWorldCardTemplatePicker('world_profile')}
                        disabled={isGenerating || isSavingWorldCard || isCreatingGame || Boolean(worldProfileCard)}
                        sx={{ ...rightPanelCompactActionButtonSx, flex: 1, minHeight: 40 }}
                      >
                        Из шаблона
                      </Button>
                    </Stack>

                    <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.08rem', fontWeight: 800, pt: 0.2 }}>Детали</Typography>
                    {displayedDetailCards.length === 0 ? (
                      <RightPanelEmptyState
                        iconSrc={icons.world}
                        title="Деталей пока нет"
                        description="Добавляйте места, предметы, заклинания, мобов и другие элементы мира, чтобы рассказчик учитывал их в сценах."
                      />
                    ) : (
                      <>
                        {cardsViewMode === 'full' ? (
                          /* Full view: portrait CharacterShowcaseCards */
                          <Stack spacing={0.85}>
                            {displayedDetailCards.map((card) => {
                              const contextState = worldCardContextStateById.get(card.id)
                              const isCardContextActive = Boolean(contextState?.isActive)
                              const memoryTurns = resolveWorldCardMemoryTurns(card)
                              const memoryTurnsLabelValue =
                                isCardContextActive &&
                                !contextState?.isAlwaysActive &&
                                typeof contextState?.turnsRemaining === 'number' &&
                                contextState.turnsRemaining > 0
                                  ? contextState.turnsRemaining
                                  : null
                              const triggerPreview =
                                card.triggers.length > 0
                                  ? `Триггеры: ${card.triggers.slice(0, 3).join(', ')}${card.triggers.length > 3 ? ', ...' : ''}`
                                  : 'Триггеры не заданы'
                              return (
                                <Box
                                  key={card.id}
                                  sx={{ '&:hover .morius-overflow-action, &:focus-within .morius-overflow-action': { opacity: 1, pointerEvents: 'auto' } }}
                                >
                                  <CharacterShowcaseCard
                                    title={card.title}
                                    description={replaceMainHeroInlineTags(card.content, mainHeroDisplayNameForTags)}
                                    imageUrl={resolveWorldCardAvatar(card)}
                                    imageScale={card.avatar_scale}
                                    eyebrow={card.detail_type || 'Деталь мира'}
                                    footerHint={triggerPreview}
                                    metaPrimary={formatWorldCardMemoryLabel(memoryTurns)}
                                    highlighted={isCardContextActive}
                                    descriptionLineClamp={4}
                                    titleAccessory={
                                      isCardContextActive && memoryTurnsLabelValue && memoryTurnsLabelValue > 0 ? (
                                        <Stack direction="row" spacing={0.42} alignItems="center" sx={{ color: 'var(--morius-title-text)' }}>
                                          <Box component="img" src={clockMemoryIcon} alt="" sx={{ width: 14, height: 14, display: 'block', opacity: 0.94 }} />
                                          <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, lineHeight: 1 }}>
                                            {memoryTurnsLabelValue}
                                          </Typography>
                                        </Stack>
                                      ) : null
                                    }
                                    onClick={() => handleOpenEditWorldCardDialog(card)}
                                    actionSlot={
                                      <IconButton
                                        className="morius-overflow-action"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          handleOpenCardMenu(event, 'world', card.id)
                                        }}
                                        disabled={isWorldCardActionLocked}
                                        sx={overflowActionButtonSx}
                                      >
                                        <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>{'\u22EE'}</Box>
                                      </IconButton>
                                    }
                                  />
                                </Box>
                              )
                            })}
                          </Stack>
                        ) : (
                          /* Compact view: landscape MobileCardItem list */
                          <Stack spacing={1.2}>
                            {displayedDetailCards.map((card) => {
                              const contextState = worldCardContextStateById.get(card.id)
                              const isCardContextActive = Boolean(contextState?.isActive)
                              const memoryTurnsLabelValue =
                                isCardContextActive &&
                                !contextState?.isAlwaysActive &&
                                typeof contextState?.turnsRemaining === 'number' &&
                                contextState.turnsRemaining > 0
                                  ? contextState.turnsRemaining
                                  : null
                              return (
                                <MobileCardItem
                                  key={card.id}
                                  imageUrl={resolveApiResourceUrl(resolveWorldCardAvatar(card))}
                                  fallbackBackground={buildWorldFallbackArtwork(card.id) as Record<string, unknown>}
                                  title={card.title}
                                  description={replaceMainHeroInlineTags(card.content, mainHeroDisplayNameForTags)}
                                  isActive={isCardContextActive}
                                  showPlayButton={false}
                                  onMenuClick={(e) => handleOpenCardMenu(e, 'world', card.id)}
                                  infoNode={
                                    isCardContextActive && memoryTurnsLabelValue ? (
                                      <Stack direction="row" spacing={0.3} alignItems="center">
                                        <Box component="img" src={clockMemoryIcon} alt="" sx={{ width: 13, height: 13, opacity: 0.9 }} />
                                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--morius-text-secondary)', lineHeight: 1 }}>
                                          {memoryTurnsLabelValue}
                                        </Typography>
                                      </Stack>
                                    ) : card.detail_type ? (
                                      <Typography sx={{ fontSize: '0.72rem', color: 'var(--morius-text-secondary)', lineHeight: 1 }}>
                                        {card.detail_type}
                                      </Typography>
                                    ) : undefined
                                  }
                                  onClick={() => handleOpenEditWorldCardDialog(card)}
                                />
                              )
                            })}
                          </Stack>
                        )}
                      </>
                    )}

                    <Stack direction="row" spacing={0.65}>
                      <Button
                        onClick={() => handleOpenCreateWorldCardDialog('world')}
                        disabled={isGenerating || isSavingWorldCard || deletingWorldCardId !== null || isCreatingGame}
                        sx={{ ...rightPanelCompactActionButtonSx, flex: 1, minHeight: 40 }}
                      >
                        Создать
                      </Button>
                      <Button
                        onClick={() => handleOpenWorldCardTemplatePicker('world')}
                        disabled={isGenerating || isSavingWorldCard || isCreatingGame}
                        sx={{ ...rightPanelCompactActionButtonSx, flex: 1, minHeight: 40 }}
                      >
                        Из шаблона
                      </Button>
                    </Stack>
                  </Stack>
                ) : cardsPanelTab === 'instructions' ? (
                  <Stack spacing={0.9}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minWidth: 0 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.16rem', fontWeight: 800 }}>Правила</Typography>
                      <ViewToggleButton cardsViewMode={cardsViewMode} setCardsViewMode={setCardsViewMode} />
                    </Stack>
                    {instructionCards.length === 0 ? (
                      <RightPanelEmptyState
                        iconSrc={icons.ai}
                        title="Правила пока не заданы"
                        description="Создайте правила или выберите шаблон, чтобы зафиксировать стиль, ограничения и важные указания для ИИ."
                      />
                    ) : (
                      <>
                        {cardsViewMode === 'full' ? (
                          /* Full view: compact title+content cards (same for all screen sizes) */
                          <Stack spacing={0.9}>
                            {instructionCards.map((card) => (
                              <Box
                                key={card.id}
                                sx={{
                                  borderRadius: '16px',
                                  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 92%, transparent)',
                                  backgroundColor: 'var(--morius-card-bg)',
                                  p: 0.9,
                                  opacity: card.is_active ? 1 : 0.78,
                                  '&:hover .morius-overflow-action, &:focus-within .morius-overflow-action': {
                                    opacity: 1,
                                    pointerEvents: 'auto',
                                  },
                                }}
                              >
                                <Stack direction="row" spacing={0.55} alignItems="center">
                                  <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.95rem', fontWeight: 800, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {card.title}
                                  </Typography>
                                  <Typography
                                    sx={{
                                      ...buildStatusChipSx(card.is_active),
                                      px: 0.55,
                                      py: 0.18,
                                      fontSize: '0.64rem',
                                      fontWeight: 700,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {card.is_active ? 'Активно' : 'Выкл'}
                                  </Typography>
                                  <IconButton
                                    className="morius-overflow-action"
                                    onClick={(event) => handleOpenCardMenu(event, 'instruction', card.id)}
                                    disabled={isInstructionCardActionLocked}
                                    sx={{ ...overflowActionButtonSx, opacity: 1, pointerEvents: 'auto', flexShrink: 0 }}
                                  >
                                    <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>{'\u22EE'}</Box>
                                  </IconButton>
                                </Stack>
                                <Typography
                                  sx={{
                                    mt: 0.45,
                                    color: 'var(--morius-text-secondary)',
                                    fontSize: '0.82rem',
                                    lineHeight: 1.42,
                                    whiteSpace: 'pre-wrap',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 4,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                  }}
                                >
                                  {replaceMainHeroInlineTags(card.content, mainHeroDisplayNameForTags)}
                                </Typography>
                              </Box>
                            ))}
                          </Stack>
                        ) : (
                          /* Compact view: landscape MobileCardItem list */
                          <Stack spacing={1.2}>
                            {instructionCards.map((card) => (
                              <MobileCardItem
                                key={card.id}
                                fallbackBackground={buildWorldFallbackArtwork(card.id + 500000) as Record<string, unknown>}
                                title={card.title}
                                description={replaceMainHeroInlineTags(card.content, mainHeroDisplayNameForTags)}
                                isActive={card.is_active}
                                showPlayButton={false}
                                onMenuClick={(e) => handleOpenCardMenu(e, 'instruction', card.id)}
                                infoNode={
                                  <Typography
                                    component="span"
                                    sx={{
                                      ...buildStatusChipSx(card.is_active),
                                      px: 0.55,
                                      py: 0.18,
                                      fontSize: '0.64rem',
                                      fontWeight: 700,
                                      borderRadius: '6px',
                                    }}
                                  >
                                    {card.is_active ? 'Активно' : 'Выкл'}
                                  </Typography>
                                }
                                onClick={() => handleOpenCardMenu(
                                  // open menu on card click in compact mode — user can pick Edit
                                  { currentTarget: document.body } as unknown as React.MouseEvent<HTMLElement>,
                                  'instruction', card.id
                                )}
                              />
                            ))}
                          </Stack>
                        )}
                      </>
                    )}
                    <Stack direction="row" spacing={0.65}>
                      <Button
                        onClick={handleOpenCreateInstructionDialog}
                        disabled={isGenerating || isSavingInstruction || isCreatingGame}
                        sx={{ ...rightPanelCompactActionButtonSx, flex: 1, minHeight: 40 }}
                      >
                        Создать
                      </Button>
                      <Button
                        onClick={handleOpenInstructionTemplateDialog}
                        disabled={isGenerating || isSavingInstruction || isCreatingGame}
                        sx={{ ...rightPanelCompactActionButtonSx, flex: 1, minHeight: 40 }}
                      >
                        Из шаблона
                      </Button>
                    </Stack>
                  </Stack>
                ) : (
                  <Stack spacing={0.9}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minWidth: 0 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.16rem', fontWeight: 800 }}>Сюжет</Typography>
                      <ViewToggleButton cardsViewMode={cardsViewMode} setCardsViewMode={setCardsViewMode} />
                    </Stack>
                    {plotCards.length === 0 ? (
                      <RightPanelEmptyState
                        iconSrc={icons.communityInfo}
                        title="Сюжет пока пуст"
                        description="Записывайте сюда важные события и незакрытые линии, чтобы держать эпизод в фокусе."
                      />
                    ) : cardsViewMode === 'compact' ? (
                      <Stack spacing={1.2}>
                        {plotCards.map((card) => {
                          const contextState = plotCardContextStateById.get(card.id)
                          const isPlotCardDisabled = isPlotCardManuallyDisabled(card)
                          const isPlotCardContextActive = Boolean(contextState?.isActive)
                          const plotTurnsRemaining =
                            isPlotCardContextActive &&
                            contextState?.lastTriggerTurn !== null &&
                            typeof contextState?.turnsRemaining === 'number' &&
                            contextState.turnsRemaining > 0
                              ? contextState.turnsRemaining
                              : null
                          return (
                            <MobileCardItem
                              key={card.id}
                              fallbackBackground={buildWorldFallbackArtwork(card.id + 700000) as Record<string, unknown>}
                              title={card.title}
                              description={replaceMainHeroInlineTags(card.content, mainHeroDisplayNameForTags)}
                              isActive={isPlotCardContextActive && !isPlotCardDisabled}
                              showPlayButton={false}
                              onMenuClick={(e) => handleOpenCardMenu(e, 'plot', card.id)}
                              infoNode={
                                <Stack direction="row" spacing={0.5} alignItems="center">
                                  {plotTurnsRemaining !== null ? (
                                    <Stack direction="row" spacing={0.42} alignItems="center" sx={{ color: 'var(--morius-title-text)' }}>
                                      <Box component="img" src={clockMemoryIcon} alt="" sx={{ width: 13, height: 13, opacity: 0.9 }} />
                                      <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, lineHeight: 1 }}>{plotTurnsRemaining}</Typography>
                                    </Stack>
                                  ) : null}
                                  <Typography
                                    component="span"
                                    sx={{
                                      ...buildStatusChipSx(isPlotCardContextActive && !isPlotCardDisabled),
                                      px: 0.55,
                                      py: 0.18,
                                      fontSize: '0.64rem',
                                      fontWeight: 700,
                                      borderRadius: '6px',
                                    }}
                                  >
                                    {formatPlotCardContextStatus(contextState)}
                                  </Typography>
                                </Stack>
                              }
                              onClick={() => handleOpenCardMenu(
                                { currentTarget: document.body } as unknown as React.MouseEvent<HTMLElement>,
                                'plot', card.id
                              )}
                            />
                          )
                        })}
                      </Stack>
                    ) : (
                      plotCards.map((card) => {
                        const contextState = plotCardContextStateById.get(card.id)
                        const resolvedPlotMemoryTurns = resolvePlotCardMemoryTurns(card)
                        const isPlotCardDisabled = isPlotCardManuallyDisabled(card)
                        const isPlotCardContextActive = Boolean(contextState?.isActive)
                        const plotTurnsRemaining =
                          isPlotCardContextActive &&
                          contextState?.lastTriggerTurn !== null &&
                          typeof contextState?.turnsRemaining === 'number' &&
                          contextState.turnsRemaining > 0
                            ? contextState.turnsRemaining
                            : null
                        return (
                          <Box
                            key={card.id}
                            sx={{
                              borderRadius: '16px',
                              border: isPlotCardDisabled
                                ? 'var(--morius-border-width) solid rgba(137, 154, 178, 0.42)'
                                : isPlotCardContextActive
                                  ? 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 54%, var(--morius-card-border))'
                                  : 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 92%, transparent)',
                              backgroundColor: isPlotCardDisabled
                                ? 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #000 18%)'
                                : isPlotCardContextActive
                                  ? 'color-mix(in srgb, var(--morius-accent) 8%, var(--morius-card-bg))'
                                  : 'var(--morius-card-bg)',
                              p: 0.9,
                              opacity: isPlotCardDisabled ? 0.82 : 1,
                            }}
                          >
                            <Stack direction="row" spacing={0.55} alignItems="center">
                              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.95rem', fontWeight: 800, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {card.title}
                              </Typography>
                              {plotTurnsRemaining !== null ? (
                                <Stack direction="row" spacing={0.42} alignItems="center" sx={{ color: 'var(--morius-title-text)', flexShrink: 0 }}>
                                  <Box component="img" src={clockMemoryIcon} alt="" sx={{ width: 14, height: 14, display: 'block', opacity: 0.94 }} />
                                  <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, lineHeight: 1 }}>
                                    {plotTurnsRemaining}
                                  </Typography>
                                </Stack>
                              ) : null}
                              <Typography
                                sx={{
                                  ...buildStatusChipSx(isPlotCardContextActive && !isPlotCardDisabled),
                                  px: 0.55,
                                  py: 0.18,
                                  fontSize: '0.64rem',
                                  fontWeight: 700,
                                }}
                              >
                                {formatPlotCardContextStatus(contextState)}
                              </Typography>
                              <IconButton
                                className="morius-overflow-action"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleOpenCardMenu(event, 'plot', card.id)
                                }}
                                disabled={isPlotCardActionLocked}
                                sx={{ ...overflowActionButtonSx, opacity: 1, pointerEvents: 'auto' }}
                              >
                                <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>{'\u22EE'}</Box>
                              </IconButton>
                            </Stack>
                            <Typography
                              sx={{
                                mt: 0.45,
                                color: 'var(--morius-text-secondary)',
                                fontSize: '0.82rem',
                                lineHeight: 1.42,
                                whiteSpace: 'pre-wrap',
                                display: '-webkit-box',
                                WebkitLineClamp: 4,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {replaceMainHeroInlineTags(card.content, mainHeroDisplayNameForTags)}
                            </Typography>
                            <Typography sx={{ mt: 0.42, color: 'rgba(171, 189, 214, 0.7)', fontSize: '0.73rem' }}>
                              Память: {resolvedPlotMemoryTurns === null ? 'выключено' : `${resolvedPlotMemoryTurns} ${formatTurnsWord(resolvedPlotMemoryTurns)}`}
                            </Typography>
                          </Box>
                        )
                      })
                    )}
                    <Button
                      onClick={handleOpenCreatePlotCardDialog}
                      disabled={isGenerating || isSavingPlotCard || deletingPlotCardId !== null || isCreatingGame}
                      sx={{
                        ...rightPanelCompactActionButtonSx,
                        minHeight: 40,
                        border: 'var(--morius-border-width) dashed var(--morius-card-border)',
                      }}
                    >
                      Создать
                    </Button>
                  </Stack>
                )}
              </Box>
            </Box>
          ) : null}

          {!shouldShowRightPanelLoadingSkeleton && rightPanelMode === 'world' && activeWorldPanelTab === 'world' ? (() => {
            const environmentEnabled = environmentTimeEnabled || environmentWeatherEnabled
            const environmentSummary = readEnvironmentString(environmentCurrentWeather?.summary) || 'Погода уточняется'
            const environmentLocationLabel = latestLocationMemoryLabel
            const environmentTimeMeta = environmentTimeEnabled
              ? [environmentDateInfo.title, environmentDateInfo.meta].filter(Boolean).join(' • ')
              : 'Время отключено'
            const environmentWeatherMeta = environmentWeatherEnabled
              ? [environmentDateInfo.seasonAndMonth ?? environmentDateInfo.season, environmentSummary].filter(Boolean).join(' • ')
              : 'Погода отключена'
            const environmentHeaderMeta = environmentTimeEnabled
              ? [environmentDateInfo.meta, environmentWeatherEnabled ? environmentSummary : 'Погода отключена']
                  .filter(Boolean)
                  .join(' • ')
              : environmentWeatherMeta

            return (
              <Box
                data-tour-id="story-world-environment-panel"
                sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}
              >
                <Box
                  sx={{
                    borderRadius: '18px',
                    border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 92%, transparent)',
                    backgroundColor: 'var(--morius-card-bg)',
                    p: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                    <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 800 }}>
                      Погода и время
                    </Typography>
                    <Typography sx={buildStatusChipSx(environmentEnabled)}>
                      {environmentEnabled ? 'Активно' : 'Выкл'}
                    </Typography>
                  </Stack>

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} justifyContent="space-between">
                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.8}>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', fontWeight: 700 }}>
                        Время
                      </Typography>
                      <Switch
                        checked={environmentTimeEnabled}
                        disabled={isSavingEnvironmentPanel || isRegeneratingEnvironmentWeather}
                        onChange={(event) => void handleToggleEnvironmentEnabled(event.target.checked)}
                        color="default"
                        sx={{
                          mr: -0.5,
                          '& .MuiSwitch-switchBase.Mui-checked': {
                            color: 'var(--morius-accent)',
                          },
                          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                            backgroundColor: 'var(--morius-accent)',
                            opacity: 0.86,
                          },
                        }}
                      />
                    </Stack>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.8}>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', fontWeight: 700 }}>
                        Погода
                      </Typography>
                      <Switch
                        checked={environmentWeatherEnabled}
                        disabled={isSavingEnvironmentPanel || isRegeneratingEnvironmentWeather}
                        onChange={(event) => void handleToggleEnvironmentWeatherEnabled(event.target.checked)}
                        color="default"
                        sx={{
                          mr: -0.5,
                          '& .MuiSwitch-switchBase.Mui-checked': {
                            color: 'var(--morius-accent)',
                          },
                          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                            backgroundColor: 'var(--morius-accent)',
                            opacity: 0.86,
                          },
                        }}
                      />
                    </Stack>
                  </Stack>

                  {!environmentEnabled ? (
                    <RightPanelEmptyState
                      iconSrc={environmentCloudIcon}
                      title="Окружение выключено"
                      description="Включите блок, чтобы история учитывала текущее время, часть суток, погоду и место сцены."
                    />
                  ) : (
                    <Stack spacing={0.85}>
                      <Box
                        role="button"
                        tabIndex={0}
                        onClick={openEnvironmentEditor}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openEnvironmentEditor()
                          }
                        }}
                        sx={{
                          borderRadius: '16px',
                          px: 0.95,
                          py: 0.9,
                          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                          backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent)',
                          cursor: 'pointer',
                        }}
                      >
                        {environmentDateInfo.seasonAndMonth ? (
                          <Typography sx={{ color: 'var(--morius-accent)', fontSize: '0.8rem', fontWeight: 700 }}>
                            {environmentDateInfo.seasonAndMonth}
                          </Typography>
                        ) : null}
                        <Typography sx={{ mt: 0.18, color: 'var(--morius-title-text)', fontSize: '1.14rem', fontWeight: 800 }}>
                          {environmentTimeEnabled ? environmentDateInfo.title : 'Время отключено'}
                        </Typography>
                        <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mt: 0.55 }}>
                          <Box component="img" src={resolveEnvironmentSummaryIcon(environmentSummary)} alt="" sx={environmentPanelIconSx} />
                          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', lineHeight: 1.35 }}>
                            {environmentHeaderMeta}
                          </Typography>
                        </Stack>
                      </Box>

                      <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={0.75}
                      >
                        <Box
                          role="button"
                          tabIndex={0}
                          onClick={openEnvironmentEditor}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openEnvironmentEditor()
                            }
                          }}
                          sx={{
                            flex: 1,
                            borderRadius: '16px',
                            px: 0.95,
                            py: 0.82,
                            border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 84%, transparent)',
                            cursor: 'pointer',
                          }}
                        >
                          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem', fontWeight: 700 }}>
                            Время
                          </Typography>
                          <Typography sx={{ mt: 0.25, color: 'var(--morius-title-text)', fontSize: '0.96rem', fontWeight: 800 }}>
                            {environmentTimeMeta}
                          </Typography>
                        </Box>

                        <Box
                          role="button"
                          tabIndex={0}
                          onClick={openEnvironmentEditor}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openEnvironmentEditor()
                            }
                          }}
                          sx={{
                            flex: 1,
                            borderRadius: '16px',
                            px: 0.95,
                            py: 0.82,
                            border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 84%, transparent)',
                            cursor: 'pointer',
                          }}
                        >
                          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem', fontWeight: 700 }}>
                            Погода
                          </Typography>
                          <Typography sx={{ mt: 0.25, color: 'var(--morius-title-text)', fontSize: '0.96rem', fontWeight: 800 }}>
                            {environmentWeatherMeta}
                          </Typography>
                        </Box>
                      </Stack>

                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                        <Button
                          onClick={openEnvironmentEditor}
                          disabled={isSavingEnvironmentPanel || isRegeneratingEnvironmentWeather}
                          sx={{
                            alignSelf: 'flex-start',
                            minHeight: 34,
                            px: 1.2,
                            borderRadius: '12px',
                            textTransform: 'none',
                            color: 'var(--morius-title-text)',
                            border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 92%, transparent)',
                            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
                          }}
                        >
                          Настроить
                        </Button>
                        <Button
                          onClick={() => void handleRegenerateEnvironmentWeather()}
                          disabled={!environmentWeatherEnabled || isSavingEnvironmentPanel || isRegeneratingEnvironmentWeather}
                          startIcon={
                            isRegeneratingEnvironmentWeather ? (
                              <CircularProgress size={14} sx={{ color: 'var(--morius-accent)' }} />
                            ) : undefined
                          }
                          sx={{
                            alignSelf: 'flex-start',
                            minHeight: 34,
                            px: 1.2,
                            borderRadius: '12px',
                            textTransform: 'none',
                            color: 'var(--morius-title-text)',
                            border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 54%, var(--morius-card-border))',
                            backgroundColor: 'color-mix(in srgb, var(--morius-button-active) 20%, var(--morius-elevated-bg))',
                            '&:hover': {
                              backgroundColor: 'color-mix(in srgb, var(--morius-button-active) 28%, var(--morius-elevated-bg))',
                            },
                          }}
                        >
                          {isRegeneratingEnvironmentWeather ? 'Перегенерация...' : 'Перегенерировать погоду'}
                        </Button>
                      </Stack>
                    </Stack>
                  )}
                </Box>

                <Box
                  role="button"
                  tabIndex={0}
                  onClick={openEnvironmentEditor}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openEnvironmentEditor()
                    }
                  }}
                  sx={{
                    borderRadius: '18px',
                    border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 92%, transparent)',
                    backgroundColor: 'var(--morius-card-bg)',
                    p: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.9,
                    cursor: 'pointer',
                  }}
                >
                  <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                    <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 800 }}>
                      Место
                    </Typography>
                    <Typography sx={buildStatusChipSx(true)}>Активно</Typography>
                  </Stack>
                  <Typography sx={{ color: 'var(--morius-accent)', fontSize: '1rem', fontWeight: 800 }}>
                    Действие происходит...
                  </Typography>
                  <Stack direction="row" spacing={0.7} alignItems="center">
                    <Box
                      sx={{
                        width: 42,
                        height: 42,
                        borderRadius: '14px',
                        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 86%, transparent)',
                        backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <ThemedSvgIcon markup={cardsWorldTabIconMarkup} size={18} sx={{ color: 'var(--morius-title-text)' }} />
                    </Box>
                    <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.88rem', lineHeight: 1.35 }}>
                      {environmentLocationLabel}
                    </Typography>
                  </Stack>
                </Box>
              </Box>
            )
          })() : null}

          {!shouldShowRightPanelLoadingSkeleton && rightPanelMode === 'ai' && activeAiPanelTab === 'instructions' ? (
            <Box data-tour-id="story-ai-instructions-panel" sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, flex: 1 }}>
              {instructionCards.length === 0 ? (
                <>
                  <Stack direction="row" spacing={0.75}>
                    <Button
                      data-tour-id="story-ai-instructions-add-first"
                      onClick={handleOpenCreateInstructionDialog}
                      disabled={isGenerating || isSavingInstruction || isCreatingGame}
                      sx={{ ...rightPanelActionButtonSx, flex: 1, minHeight: 46 }}
                    >
                      Создать
                    </Button>
                    <Button
                      data-tour-id="story-ai-instructions-template"
                      onClick={handleOpenInstructionTemplateDialog}
                      disabled={isGenerating || isSavingInstruction || isCreatingGame}
                      sx={{ ...rightPanelActionButtonSx, flex: 1, minHeight: 46 }}
                    >
                      Из шаблона
                    </Button>
                  </Stack>
                  <RightPanelEmptyState
                    tourId="story-ai-instructions-empty-state"
                    iconSrc={icons.communityCards}
                    title="Инструкции"
                    description="Задавайте свои шаблоны и ограничения, которым будет следовать ИИ. Например: отвечай максимум 5 небольшими абзацами, в художественном стиле."
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
                            '&:hover .morius-overflow-action, &:focus-within .morius-overflow-action': {
                              opacity: 1,
                              pointerEvents: 'auto',
                            },
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
                                ...buildStatusChipSx(card.is_active),
                                fontSize: '0.66rem',
                                fontWeight: 700,
                                px: 0.55,
                                py: 0.18,
                                flexShrink: 0,
                              }}
                            >
                              {card.is_active ? 'активно' : 'неактивно'}
                            </Typography>
                            <IconButton
                              className="morius-overflow-action"
                              onClick={(event) => handleOpenCardMenu(event, 'instruction', card.id)}
                              disabled={isInstructionCardActionLocked}
                              sx={{ ...overflowActionButtonSx, ml: 'auto' }}
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
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    }}
                  >
                    <Button
                      onClick={handleOpenCreateInstructionDialog}
                      disabled={isGenerating || isSavingInstruction || deletingInstructionId !== null || isCreatingGame}
                      sx={{
                        ...rightPanelCompactActionButtonSx,
                        width: '100%',
                        minHeight: 40,
                        border: 'var(--morius-border-width) dashed color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                      }}
                    >
                      Создать
                    </Button>
                    <Button
                      onClick={handleOpenInstructionTemplateDialog}
                      disabled={isGenerating || isSavingInstruction || deletingInstructionId !== null || isCreatingGame}
                      sx={{ ...rightPanelCompactActionButtonSx, width: '100%', minHeight: 40 }}
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
                          <SettingsInfoTooltipIcon
                            text={`${STORY_SETTINGS_INFO_TEXT.narrator} Также доступны GLM 5.1, Xiaomi Mimo Pro и AionLabs.`}
                          />
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
                                    backgroundColor: 'transparent',
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
                            boxShadow: 'none',
                            px: 1,
                            pb: 1.05,
                            pt: 0.9,
                          }}
                        >
                          <Typography
                            sx={{
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
                            {selectedNarratorOption.stats.map((stat, statIndex) => {
                              const statLabel = resolveNarratorStatLabel(stat.label, statIndex)
                              return (
                              <Stack key={`${selectedNarratorOption.id}-${statIndex}`} direction="row" alignItems="center" justifyContent="space-between">
                                <Typography
                                  sx={{
                                    color: 'var(--morius-title-text)',
                                    fontSize: '1.02rem',
                                    fontWeight: 600,
                                    lineHeight: 1.1,
                                  }}
                                >
                                  {statLabel}
                                </Typography>
                                <Stack direction="row" spacing={0.42}>
                                  {Array.from({ length: NARRATOR_STAT_DOT_COUNT }).map((_, dotIndex) => {
                                    const isActiveDot = dotIndex < stat.value
                                    return (
                                      <Box
                                        key={`${selectedNarratorOption.id}-${statIndex}-${dotIndex}`}
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
                              )
                            })}
                          </Stack>
                        </Box>
                        <Box
                          sx={{
                            mt: 0.95,
                            pt: 0.95,
                            borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                          }}
                        >
                          <Stack direction="row" spacing={0.45} alignItems="center">
                            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem', fontWeight: 600 }}>
                              Оптимизация памяти
                            </Typography>
                            <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.memoryOptimizationMode} />
                          </Stack>
                          <FormControl fullWidth size="small" sx={{ mt: 0.72 }}>
                            <Select
                              value={memoryOptimizationMode}
                              disabled={isSavingStorySettings || isGenerating}
                              onChange={(event: SelectChangeEvent<string>) => {
                                const nextMode = normalizeStoryMemoryOptimizationMode(event.target.value)
                                void persistStoryMemoryOptimizationMode(nextMode)
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
                                      backgroundColor: 'transparent',
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
                              {STORY_MEMORY_OPTIMIZATION_MODE_OPTIONS.map((option) => (
                                <MenuItem key={option.value} value={option.value}>
                                  {option.label}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
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
                                    backgroundColor: 'transparent',
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
                              Продвинутая перегенерация
                            </Typography>
                            <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.advancedRegeneration} />
                          </Stack>
                          <Switch
                            checked={advancedRegenerationEnabled}
                            onChange={toggleAdvancedRegenerationEnabled}
                            disabled={isGenerating}
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
                              Плавная печать ответов
                            </Typography>
                            <SettingsInfoTooltipIcon text="Сглаживает потоковый ответ ИИ на экране, даже если сервер прислал текст крупными или неровными порциями." />
                          </Stack>
                          <Switch
                            checked={smoothStreamingEnabled}
                            onChange={toggleSmoothStreamingEnabled}
                            disabled={isGenerating}
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
                              Авто состояние
                            </Typography>
                            <SettingsInfoTooltipIcon text="Если включено, ИИ будет внутри основного запроса отслеживать изменения одежды, инвентаря и состояния здоровья персонажей и обновлять только изменившиеся поля. Если выключено, эти поля остаются только ручными." />
                          </Stack>
                          <Switch
                            checked={characterStateEnabled}
                            onChange={() => {
                              void toggleCharacterStateEnabled()
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

                        {isAdministrator ? (
                          <>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8}>
                              <Stack direction="row" spacing={0.45} alignItems="center">
                                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', fontWeight: 700 }}>
                                  RPG pipeline v1
                                </Typography>
                                <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.canonicalStatePipeline} />
                              </Stack>
                              <Switch
                                checked={canonicalStatePipelineEnabled}
                                onChange={() => {
                                  void toggleCanonicalStatePipelineEnabled()
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
                                  Safe fallback
                                </Typography>
                                <SettingsInfoTooltipIcon text={STORY_SETTINGS_INFO_TEXT.canonicalStateSafeFallback} />
                              </Stack>
                              <Switch
                                checked={canonicalStatePipelineEnabled && canonicalStateSafeFallbackEnabled}
                                onChange={() => {
                                  void toggleCanonicalStateSafeFallbackEnabled()
                                }}
                                disabled={!canonicalStatePipelineEnabled || isSavingStorySettings || isGenerating}
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
                                  Режим новеллы
                                </Typography>
                                <SettingsInfoTooltipIcon text="Показывает сцену в формате визуальной новеллы только в тех ходах, где есть взаимодействие и для героев уже подготовлены эмоции." />
                              </Stack>
                              <Switch
                                checked={emotionVisualizationEnabled}
                                onChange={() => {
                                  void toggleEmotionVisualizationEnabled()
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
                          </>
                        ) : null}

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

                        {isSavingThoughtVisibility ||
                        isSavingAmbientEnabled ||
                        isSavingCharacterStateEnabled ||
                        isSavingEmotionVisualizationEnabled ||
                        isSavingCanonicalStatePipeline ||
                        isSavingCanonicalStateSafeFallback ? (
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
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 700 }}>Параметры</Typography>
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
                              <SettingsInfoTooltipIcon text={getStoryTurnCostTooltipText()} />
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
                                  backgroundColor: 'transparent',
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
                                (storyTemperature === selectedNarratorSamplingDefaults.storyTemperature &&
                                  storyRepetitionPenalty === selectedNarratorSamplingDefaults.storyRepetitionPenalty &&
                                  storyTopK === selectedNarratorSamplingDefaults.storyTopK &&
                                  storyTopR === selectedNarratorSamplingDefaults.storyTopR)
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
                                  backgroundColor: 'transparent',
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

                          <Box sx={{ mt: 0.34 }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                              <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.8rem', fontWeight: 700 }}>
                                Repetition penalty
                              </Typography>
                              <TextField
                                value={storyRepetitionPenaltyDraft}
                                onChange={(event) => {
                                  handleStoryRepetitionPenaltyDraftChange(event.target.value)
                                }}
                                onBlur={() => {
                                  void handleStoryRepetitionPenaltyDraftCommit()
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    void handleStoryRepetitionPenaltyDraftCommit()
                                  }
                                }}
                                disabled={isSavingStorySettings || isGenerating}
                                inputProps={{
                                  inputMode: 'decimal',
                                  'aria-label': 'Repetition penalty',
                                }}
                                sx={{
                                  width: 84,
                                  '& .MuiInputBase-root': {
                                    height: 34,
                                    borderRadius: '10px',
                                    backgroundColor: 'var(--morius-elevated-bg)',
                                  },
                                  '& .MuiInputBase-input': {
                                    py: 0.55,
                                    px: 1,
                                    textAlign: 'right',
                                    color: 'var(--morius-text-secondary)',
                                    fontSize: '0.76rem',
                                    fontWeight: 700,
                                  },
                                }}
                              />
                            </Stack>
                            <Slider
                              value={storyRepetitionPenalty}
                              min={STORY_REPETITION_PENALTY_MIN}
                              max={STORY_REPETITION_PENALTY_MAX}
                              step={0.01}
                              onChange={handleStoryRepetitionPenaltySliderChange}
                              onChangeCommitted={(event, value) => {
                                void handleStoryRepetitionPenaltySliderCommit(event, value)
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
                  backgroundColor: 'var(--morius-elevated-bg)',
                  '&:hover': {
                    backgroundColor: 'color-mix(in srgb, var(--morius-button-hover) 88%, var(--morius-elevated-bg))',
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
                            backgroundColor: 'transparent',
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
                  DEV В?  память
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
                          {getStoryMemoryLayerLabel(layer, memoryOptimizationMode)}
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
                                  backgroundColor: 'transparent',
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

          {false && !shouldShowRightPanelLoadingSkeleton && rightPanelMode === 'world' && activeWorldPanelTab === 'story' ? (
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
                      backgroundColor: 'var(--morius-elevated-bg)',
                      '&:hover': {
                        backgroundColor: 'color-mix(in srgb, var(--morius-button-hover) 88%, var(--morius-elevated-bg))',
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
                        const isPlotCardDisabled = isPlotCardManuallyDisabled(card)
                        const resolvedPlotCardContent = replaceMainHeroInlineTags(card.content, mainHeroDisplayNameForTags)
                        return (
                        <Box key={card.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.45 }}>
                          <Stack direction="row" spacing={0.45} sx={{ flexWrap: 'wrap', px: 0 }}>
                            <Typography
                              sx={{
                                color: isCardContextActive ? 'var(--morius-accent)' : 'rgba(155, 172, 196, 0.84)',
                                fontSize: '0.64rem',
                                lineHeight: 1,
                                letterSpacing: 0.22,
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                border: isCardContextActive
                                  ? 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 44%, var(--morius-card-border))'
                                  : 'var(--morius-border-width) solid rgba(137, 154, 178, 0.38)',
                                backgroundColor: isCardContextActive
                                  ? 'color-mix(in srgb, var(--morius-accent) 12%, transparent)'
                                  : 'transparent',
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
                              border: isPlotCardDisabled
                                ? 'var(--morius-border-width) solid rgba(137, 154, 178, 0.42)'
                                : isCardContextActive
                                  ? 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 54%, var(--morius-card-border))'
                                  : 'var(--morius-border-width) solid var(--morius-card-border)',
                              backgroundColor: isPlotCardDisabled
                                ? 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #000 18%)'
                                : isCardContextActive
                                  ? 'color-mix(in srgb, var(--morius-accent) 8%, var(--morius-elevated-bg))'
                                  : 'var(--morius-elevated-bg)',
                              boxShadow: isCardContextActive
                                ? '0 0 0 1px color-mix(in srgb, var(--morius-accent) 20%, transparent) inset'
                                : 'none',
                              px: 'var(--morius-story-right-padding)',
                              py: 'var(--morius-story-right-padding)',
                              height: RIGHT_PANEL_CARD_HEIGHT,
                              display: 'flex',
                              flexDirection: 'column',
                              overflow: 'hidden',
                              opacity: isPlotCardDisabled ? 0.82 : 1,
                              '&:hover .morius-overflow-action, &:focus-within .morius-overflow-action': {
                                opacity: 1,
                                pointerEvents: 'auto',
                              },
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
                            </Stack>
                            <Typography
                              sx={{
                                mt: 0.55,
                                color: isPlotCardDisabled ? 'rgba(181, 194, 214, 0.72)' : 'rgba(207, 217, 232, 0.86)',
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

          {false && !shouldShowRightPanelLoadingSkeleton && rightPanelMode === 'world' && activeWorldPanelTab === 'world' ? (
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
                      '&:hover .morius-overflow-action, &:focus-within .morius-overflow-action': {
                        opacity: 1,
                        pointerEvents: 'auto',
                      },
                    }}
                  >
                    {renderPreviewableCharacterAvatar({
                      avatarUrl: mainHeroAvatarUrl,
                      previewUrl: mainHeroPreviewAvatarUrl,
                      avatarScale: mainHeroCard!.avatar_scale,
                      fallbackLabel: mainHeroCard!.title,
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
                        {mainHeroCard!.title}
                      </Typography>
                      <Typography sx={{ color: 'rgba(166, 186, 214, 0.74)', fontSize: '0.74rem', lineHeight: 1.1 }}>
                        Главный герой выбран
                      </Typography>
                      {characterStateEnabled ? (
                        <Typography
                          sx={{
                            color: mainHeroCard!.ai_edit_enabled ? 'rgba(158, 196, 238, 0.76)' : 'rgba(246, 176, 176, 0.86)',
                            fontSize: '0.7rem',
                            lineHeight: 1.1,
                          }}
                        >
                          {getWorldCardAiEditStatusLabel(mainHeroCard!)}
                        </Typography>
                      ) : null}
                    </Stack>
                    <IconButton
                      className="morius-overflow-action"
                      onClick={(event) => handleOpenCardMenu(event, 'world', mainHeroCard!.id)}
                      disabled={isWorldCardActionLocked}
                      sx={{ ...overflowActionButtonSx, ml: 'auto', flexShrink: 0 }}
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
                                color: isCardContextActive ? 'var(--morius-accent)' : 'rgba(155, 172, 196, 0.84)',
                                fontSize: '0.64rem',
                                lineHeight: 1,
                                letterSpacing: 0.22,
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                border: isCardContextActive
                                  ? 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 44%, var(--morius-card-border))'
                                  : 'var(--morius-border-width) solid rgba(137, 154, 178, 0.38)',
                                backgroundColor: isCardContextActive
                                  ? 'color-mix(in srgb, var(--morius-accent) 12%, transparent)'
                                  : 'transparent',
                                borderRadius: '999px',
                                px: 0.55,
                                py: 0.18,
                              }}
                            >
                              {formatWorldCardContextStatus(contextState)}
                            </Typography>
                            {characterStateEnabled ? (
                              <Typography
                                sx={{
                                  color: card.ai_edit_enabled ? 'rgba(158, 196, 238, 0.76)' : 'rgba(246, 176, 176, 0.86)',
                                  fontSize: '0.64rem',
                                  lineHeight: 1.15,
                                  letterSpacing: 0.18,
                                  textTransform: 'none',
                                  fontWeight: 700,
                                  border: card.ai_edit_enabled
                                    ? 'var(--morius-border-width) solid rgba(132, 168, 210, 0.4)'
                                    : 'var(--morius-border-width) solid rgba(236, 148, 148, 0.46)',
                                  borderRadius: '999px',
                                  px: 0.55,
                                  py: 0.28,
                                }}
                              >
                                {getWorldCardAiEditStatusLabel(card)}
                              </Typography>
                            ) : null}
                          </Stack>
                          <Box
                            sx={{
                              borderRadius: '12px',
                              border: isCardContextActive
                                ? 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 54%, var(--morius-card-border))'
                                : 'var(--morius-border-width) solid var(--morius-card-border)',
                              backgroundColor: isCardContextActive
                                ? 'color-mix(in srgb, var(--morius-accent) 8%, var(--morius-elevated-bg))'
                                : 'var(--morius-elevated-bg)',
                              boxShadow: isCardContextActive
                                ? '0 0 0 1px color-mix(in srgb, var(--morius-accent) 20%, transparent) inset'
                                : 'none',
                              px: 'var(--morius-story-right-padding)',
                              py: 'var(--morius-story-right-padding)',
                              height: RIGHT_PANEL_CARD_HEIGHT,
                              display: 'flex',
                              flexDirection: 'column',
                              overflow: 'hidden',
                              '&:hover .morius-overflow-action, &:focus-within .morius-overflow-action': {
                                opacity: 1,
                                pointerEvents: 'auto',
                              },
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
                                  РР
                                </Typography>
                              ) : null}
                              <IconButton
                                className="morius-overflow-action"
                                onClick={(event) => handleOpenCardMenu(event, 'world', card.id)}
                                disabled={isWorldCardActionLocked}
                                sx={overflowActionButtonSx}
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
                onClick={() => handleOpenCreateWorldCardDialog('world')}
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
            {shouldShowEmotionStage ? (
              <Box
                ref={emotionStagePanelRef}
                sx={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 3,
                  mb: 1.6,
                  overflow: 'hidden',
                  borderRadius: 0,
                  height: currentEmotionStageHeight,
                  background: 'var(--morius-app-bg)',
                }}
              >
                <Stack spacing={0} sx={{ position: 'relative', height: '100%', minHeight: 0 }}>
                  <Box
                    sx={{
                      position: 'relative',
                      flex: 1,
                      minHeight: 0,
                      overflow: 'hidden',
                      px: { xs: 1.2, md: 2.4 },
                    }}
                  >
                    {currentVisualStageHeroParticipant ? (
                      <Box
                        sx={{
                          position: 'absolute',
                          left: { xs: '1%', md: '2%' },
                          bottom: 0,
                          width: { xs: '48%', md: '44%' },
                          height: '100%',
                          display: 'flex',
                          alignItems: 'flex-end',
                          justifyContent: 'flex-start',
                          zIndex: 7,
                        }}
                      >
                        <ProgressiveImage
                          src={currentVisualStageHeroParticipant.assetUrl}
                          alt={`${currentVisualStageHeroParticipant.displayName} ${STORY_CHARACTER_EMOTION_LABELS[currentVisualStageHeroParticipant.emotion]}`}
                          loading="eager"
                          fetchPriority="high"
                          objectFit="contain"
                          objectPosition="left bottom"
                          loaderSize={30}
                          containerSx={{
                            width: '100%',
                            height: '100%',
                          }}
                          imgSx={{
                            transform: {
                              xs: 'translateY(11%) scale(1.28)',
                              md: 'translateY(13%) scale(1.42)',
                            },
                            userSelect: 'none',
                            pointerEvents: 'none',
                          }}
                        />
                      </Box>
                    ) : null}

                    {currentVisualStageNpcParticipants.length > 0 ? (
                      <Box
                        sx={{
                          position: 'absolute',
                          right: { xs: '0%', md: '1%' },
                          bottom: 0,
                          width: { xs: '58%', md: '56%' },
                          height: '100%',
                          minHeight: 0,
                        }}
                      >
                        {currentVisualStageNpcParticipants.map((participant, index) => {
                          const slot =
                            currentVisualStageNpcSlots[index] ??
                            currentVisualStageNpcSlots[currentVisualStageNpcSlots.length - 1]
                          return (
                            <Box
                              key={`${participant.displayName}-${participant.emotion}-${index}`}
                              sx={{
                                position: 'absolute',
                                right: { xs: slot.rightXs, md: slot.rightMd },
                                bottom: 0,
                                width: { xs: slot.widthXs, md: slot.widthMd },
                                height: '100%',
                                display: 'flex',
                                alignItems: 'flex-end',
                                justifyContent: 'flex-end',
                                zIndex: slot.zIndex,
                              }}
                            >
                              <ProgressiveImage
                                src={participant.assetUrl}
                                alt={`${participant.displayName} ${STORY_CHARACTER_EMOTION_LABELS[participant.emotion]}`}
                                loading="eager"
                                fetchPriority="high"
                                objectFit="contain"
                                objectPosition="right bottom"
                                loaderSize={28}
                                containerSx={{
                                  width: '100%',
                                  height: '100%',
                                }}
                                imgSx={{
                                  transform: {
                                    xs: `translateY(${slot.liftXs}%) scaleX(-1) scale(${slot.scaleXs})`,
                                    md: `translateY(${slot.liftMd}%) scaleX(-1) scale(${slot.scaleMd})`,
                                  },
                                  opacity: slot.opacity,
                                  userSelect: 'none',
                                  pointerEvents: 'none',
                                }}
                              />
                            </Box>
                          )
                        })}
                      </Box>
                    ) : null}
                  </Box>
                  <Box
                    role="separator"
                    aria-orientation="horizontal"
                    onPointerDown={handleStartEmotionStageResize}
                    sx={{
                      px: { xs: 0.8, md: 1.4 },
                      pb: 0.55,
                      pt: 0,
                      cursor: 'row-resize',
                      touchAction: 'none',
                    }}
                  >
                    <Box
                      sx={{
                        height: 16,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Box
                        sx={{
                          width: 78,
                          height: 4,
                          borderRadius: '999px',
                          backgroundColor: 'color-mix(in srgb, var(--morius-card-border) 86%, transparent)',
                        }}
                      />
                    </Box>
                  </Box>
                </Stack>
              </Box>
            ) : null}
            {shouldShowStoryMessagesLoadingSkeleton ? (
              <StoryMessagesLoadingSkeleton />
            ) : null}

            {!shouldShowStoryMessagesLoadingSkeleton && isLoadingGameMessages ? (
              <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 220 }}>
                <CircularProgress size={28} />
              </Stack>
            ) : null}

            {!shouldShowStoryMessagesLoadingSkeleton && !isLoadingGameMessages ? (
              quickStartIntroBlocks.length > 0 && shouldRenderStandaloneQuickStartIntro ? (
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
              ? renderedMessages.map((message) => {
                  if (message.role === 'user') {
                    const normalizedUserMessageContent = toStoryText(message.content).replace(/\r\n/g, '\n').trim()
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
                    const blocks = assistantBlocksByMessageId.get(message.id) ?? []
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
                    if (
                      blocks.length === 0 &&
                      assistantTurnImages.length === 0 &&
                      messagePlotCardEvents.length === 0 &&
                      messageWorldCardEvents.length === 0 &&
                      !isStreaming &&
                      !shouldShowContinueButton
                    ) {
                      return null
                    }
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
                            const shouldShowStreamingCaret = isStreaming && index === blocks.length - 1
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
	                                          block.sourceIndex,
	                                          event.currentTarget.textContent ?? '',
	                                        )
                                        if (nextContent === null) {
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
                                      {shouldShowStreamingCaret ? (
                                        <Box component="span" className={STREAMING_CARET_CLASS_NAME} aria-hidden="true" />
                                      ) : null}
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
                                      block.sourceIndex,
                                      event.currentTarget.textContent ?? '',
                                    )
                                    if (nextContent === null) {
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
                                  {shouldShowStreamingCaret ? (
                                    <Box component="span" className={STREAMING_CARET_CLASS_NAME} aria-hidden="true" />
                                  ) : null}
                                </Box>
                              </Box>
                            )
                          })}
                          {isStreaming && blocks.length === 0 ? (
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
                                          <AssetMaskIcon src={icons.back} size={14} sx={{ opacity: 0.88 }} />
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
                                        ?
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
                                        {isExpanded ? '?' : '?'}
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
                                          <AssetMaskIcon src={icons.back} size={14} sx={{ opacity: 0.88 }} />
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
                                        ?
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
                                        {isExpanded ? '?' : '?'}
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
                                  <ProgressiveImage
                                    src={assistantTurnImage.imageUrl}
                                    alt="Scene frame"
                                    loading="lazy"
                                    fetchPriority="low"
                                    objectFit="contain"
                                    loaderSize={28}
                                    containerSx={{
                                      width: '100%',
                                      minHeight: 180,
                                      background: 'transparent',
                                    }}
                                    imgSx={{
                                      position: 'relative',
                                      width: '100%',
                                      height: 'auto',
                                      objectFit: 'contain',
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
                          {shouldShowContinueButton ? null : null}
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
          maxWidth: STORY_STAGE_MAX_WIDTH,
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
        <Stack
          spacing={0.72}
          sx={{
            position: 'relative',
            zIndex: 1,
          }}
        >
          <Box
            data-tour-id="story-composer-controls"
            sx={{
              overflowX: { xs: 'auto', md: 'visible' },
              overflowY: 'visible',
              pb: 0.1,
              '&::-webkit-scrollbar': {
                display: 'none',
              },
              scrollbarWidth: 'none',
            }}
          >
            <Stack
              direction="row"
              alignItems="flex-end"
              spacing={0.82}
              sx={{
                width: 'max-content',
                minWidth: '100%',
              }}
            >
              <Stack direction="row" alignItems="flex-end" spacing={0.82}>
                <Tooltip
                  arrow
                  placement="top"
                  title={<Box sx={{ whiteSpace: 'pre-line' }}>{getStoryTurnCostTooltipText()}</Box>}
                >
                  <Box
                    sx={{
                      minWidth: 72,
                      px: 0.85,
                      height: COMPOSER_TOP_ACTION_BUTTON_SIZE,
                      borderRadius: '16px',
                      border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
                      background: 'color-mix(in srgb, var(--morius-card-bg) 90%, #000 10%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 0.48,
                      cursor: 'help',
                      flexShrink: 0,
                    }}
                  >
                    <AssetMaskIcon src={icons.coin} size={16} sx={{ opacity: 0.98 }} />
                    <Typography
                      sx={{
                        color: 'var(--morius-title-text)',
                        fontSize: '1.15rem',
                        lineHeight: 1,
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {currentTurnCostTokens}
                    </Typography>
                  </Box>
                </Tooltip>
                <Tooltip arrow placement="top" title="Назад">
                  <span>
                    <IconButton
                      aria-label="Назад"
                      onClick={() => void handleUndoAssistantStep()}
                      disabled={!canUndoAssistantStep}
                      sx={getComposerTopActionButtonSx()}
                    >
                      <AssetMaskIcon src={icons.back} size={18} sx={composerActionImageSx} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip arrow placement="top" title="Отменить">
                  <span>
                    <IconButton
                      aria-label="Отменить"
                      onClick={() => void handleRedoAssistantStep()}
                      disabled={!canRedoAssistantStep}
                      sx={getComposerTopActionButtonSx()}
                    >
                      <AssetMaskIcon src={icons.undo} size={18} sx={composerActionImageSx} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip arrow placement="top" title="Перегенерировать">
                  <span>
                    <IconButton
                      aria-label="Перегенерировать"
                      onClick={handleRerollButtonClick}
                      disabled={!canReroll}
                      sx={getComposerTopActionButtonSx()}
                    >
                      <AssetMaskIcon src={icons.reload} size={18} sx={composerActionImageSx} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
              <Stack direction="row" alignItems="flex-end" spacing={0.82} sx={{ ml: 'auto', pl: 0.82 }}>
                <Box
                  sx={{
                    width: COMPOSER_TOP_ACTION_BUTTON_SIZE,
                    minWidth: COMPOSER_TOP_ACTION_BUTTON_SIZE,
                    maxWidth: COMPOSER_TOP_ACTION_BUTTON_SIZE,
                    height: COMPOSER_TOP_ACTION_BUTTON_SIZE,
                    flexShrink: 0,
                    position: 'relative',
                    overflow: 'visible',
                  }}
                >
                  <Box
                    ref={composerAiMenuRef}
                    sx={{
                      position: 'absolute',
                      right: 0,
                      bottom: 0,
                      width: COMPOSER_TOP_ACTION_BUTTON_SIZE,
                      height: COMPOSER_TOP_ACTION_BUTTON_SIZE,
                      overflow: 'visible',
                      zIndex: 30,
                    }}
                  >
                    <Tooltip arrow placement="top" title="ИИ-функции">
                      <span>
                        <IconButton
                          ref={composerAiButtonRef}
                          aria-label="ИИ-функции"
                          onClick={handleToggleComposerAiMenu}
                          sx={{
                            ...getComposerTopActionButtonSx({ highlighted: isComposerAiMenuOpen }),
                            position: 'absolute',
                            right: 0,
                            bottom: 0,
                            zIndex: 2,
                            transform: isComposerAiMenuOpen ? 'translateY(calc(-100% - 8px))' : 'translateY(0)',
                            transition:
                              'transform 180ms ease, color 160ms ease, opacity 160ms ease, background-color 160ms ease, border-color 160ms ease',
                          }}
                        >
                          <AssetMaskIcon src={icons.ai} size={20} sx={{ opacity: isComposerAiMenuOpen ? 1 : 0.92 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip
                      arrow
                      placement="top"
                      title={hasLatestTurnImage ? 'Перегенерировать картинку' : 'Сгенерировать картинку'}
                    >
                      <span>
                        <IconButton
                          aria-label={hasLatestTurnImage ? 'Перегенерировать картинку' : 'Сгенерировать картинку'}
                          onClick={handleGenerateLatestTurnImage}
                          disabled={!canGenerateLatestTurnImage}
                          sx={{
                            ...getComposerTopActionButtonSx({ highlighted: hasLatestTurnImage }),
                            position: 'absolute',
                            right: 0,
                            bottom: 0,
                            zIndex: 1,
                            opacity: isComposerAiMenuOpen ? 1 : 0,
                            transform: isComposerAiMenuOpen ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.9)',
                            transition: 'opacity 180ms ease, transform 180ms ease',
                            pointerEvents: isComposerAiMenuOpen ? 'auto' : 'none',
                          }}
                        >
                          {isLatestTurnImageLoading ? (
                            <CircularProgress size={18} sx={{ color: 'var(--morius-accent)' }} />
                          ) : (
                            <AssetMaskIcon
                              src={hasLatestTurnImage ? composerRegenerateImageIcon : composerGenerateImageIcon}
                              size={20}
                              sx={{ opacity: 0.96 }}
                            />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </Box>
                <Tooltip arrow placement="top" title="Продолжить">
                  <span>
                    <IconButton
                      aria-label="Продолжить"
                      onClick={handleContinueLatestTurn}
                      disabled={!canContinueLatestTurn}
                      sx={{
                        ...getComposerTopActionButtonSx(),
                        color: secondaryGameButtonColor,
                      }}
                    >
                      <ComposerContinueIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
          </Box>
          <Box
            data-tour-id="story-composer-input"
            sx={{
              width: '100%',
              borderRadius: '18px',
              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 86%, transparent)',
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--morius-card-bg) 96%, #000 4%) 0%, color-mix(in srgb, var(--morius-card-bg) 98%, #000 2%) 100%)',
              position: 'relative',
              overflow: 'hidden',
              transition: 'border-color 160ms ease, box-shadow 160ms ease, background 160ms ease',
              '&:focus-within': {
                borderColor: 'color-mix(in srgb, var(--morius-accent) 46%, var(--morius-card-border))',
                boxShadow: '0 0 0 1px color-mix(in srgb, var(--morius-accent) 14%, transparent)',
              },
            }}
          >
            <Box
              component="textarea"
              ref={textAreaRef}
              rows={1}
              value={inputValue}
              placeholder={inputPlaceholder}
              maxLength={STORY_PROMPT_MAX_LENGTH}
              disabled={isStoryTurnBusy || hasInsufficientTokensForTurn}
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
                display: 'block',
                width: '100%',
                minHeight: `${COMPOSER_INPUT_MIN_HEIGHT}px !important`,
                maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
                resize: 'none',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--morius-title-text)',
                fontSize: { xs: '1rem', sm: '1.02rem' },
                lineHeight: 1.45,
                fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
                boxSizing: 'border-box',
                px: { xs: 1.95, sm: 2.15 },
                py: { xs: '8px', sm: '9px' },
                pr: { xs: 5.6, sm: 6 },
                overflowY: 'hidden',
                '&::placeholder': {
                  color: 'var(--morius-text-secondary)',
                },
              }}
            />
            <IconButton
              className="morius-composer-send-button"
              aria-label={isGenerating ? 'Остановить генерацию' : isFinalizingStoryTurn ? 'Синхронизируем ход' : 'Отправить'}
              onClick={handleVoiceActionClick}
              disabled={isGenerating ? false : (isFinalizingStoryTurn || (showMicAction ? (!canUseVoiceInput && !isVoiceInputActive) : (isCreatingGame || !hasPromptText)))}
              sx={{
                '@keyframes morius-voice-pulse': {
                  '0%, 100%': {
                    transform: 'scale(1)',
                    opacity: 1,
                  },
                  '50%': {
                    transform: 'scale(1.08)',
                    opacity: 0.78,
                  },
                },
                position: 'absolute',
                top: '50%',
                right: 18,
                transform: 'translateY(-50%)',
                width: `${COMPOSER_SEND_BUTTON_SIZE}px !important`,
                height: `${COMPOSER_SEND_BUTTON_SIZE}px !important`,
                minWidth: `${COMPOSER_SEND_BUTTON_SIZE}px !important`,
                minHeight: `${COMPOSER_SEND_BUTTON_SIZE}px !important`,
                p: 0,
                borderRadius: '999px',
                backgroundColor: 'transparent',
                border: 'none',
                color: isGenerating ? 'var(--morius-accent)' : sendButtonIconColor,
                ...(isVoiceInputActive && showMicAction
                  ? {
                      color: sendButtonIconColor,
                      animation: 'morius-voice-pulse 1.05s ease-in-out infinite',
                    }
                  : {}),
                '& svg': {
                  width: 18,
                  height: 18,
                },
                '&:hover': {
                  backgroundColor: 'transparent',
                },
                '&:active': {
                  backgroundColor: 'transparent',
                },
                '&:disabled': {
                  opacity: isGenerating ? 0.7 : 0.62,
                  color: isGenerating ? 'var(--morius-accent)' : sendButtonIconColor,
                  backgroundColor: 'transparent',
                  border: 'none',
                },
              }}
            >
              {isGenerating ? (
                <Box
                  className="morius-stop-indicator"
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    backgroundColor: 'var(--morius-accent)',
                  }}
                />
              ) : isFinalizingStoryTurn ? (
                <CircularProgress size={16} sx={{ color: 'var(--morius-accent)' }} />
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
                <AssetMaskIcon src={icons.send} size={18} />
              )}
            </IconButton>
            {isVoiceInputActive && showMicAction ? (
              <Stack
                direction="row"
                alignItems="center"
                spacing={0.45}
                sx={{
                  position: 'absolute',
                  left: 14,
                  bottom: 10,
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
                  Идет запись...
                </Typography>
              </Stack>
            ) : isFinalizingStoryTurn && !isGenerating ? (
              <Stack
                direction="row"
                alignItems="center"
                spacing={0.65}
                sx={{
                  position: 'absolute',
                  left: 14,
                  bottom: 10,
                  color: 'var(--morius-accent)',
                }}
              >
                <CircularProgress size={10} sx={{ color: 'var(--morius-accent)' }} />
                <Typography sx={{ fontSize: '0.73rem', lineHeight: 1, fontWeight: 700 }}>
                  Синхронизируем ход...
                </Typography>
              </Stack>
            ) : null}
          </Box>

          <TextLimitIndicator
            currentLength={inputValue.length}
            maxLength={STORY_PROMPT_MAX_LENGTH}
            sx={{
              width: 'auto',
              minWidth: 0,
              alignSelf: 'flex-end',
              mr: 0.3,
            }}
          />
        </Stack>
      </Box>

      <BaseDialog
        open={contextBudgetWarning !== null}
        onClose={() => setContextBudgetWarning(null)}
        transitionComponent={DialogTransition}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Не хватает памяти контекста</DialogTitle>
        <DialogContent>
          <Stack spacing={1.1}>
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>
              Карточки сюжета заняли слишком большой кусок контекста и начинают выталкивать dev-memory. Я не режу их прямо в этот момент, а сначала предупреждаю после хода.
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)' }}>
              Переполнение по сюжету: {formatContextChars(contextBudgetWarning?.plotOverflowTokens ?? 0)} токенов.
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-primary)', fontWeight: 700 }}>
              Рекомендуемый лимит: {formatContextChars(contextBudgetWarning?.recommendedLimit ?? contextLimitChars)} токенов.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={() => setContextBudgetWarning(null)} sx={{ textTransform: 'none' }}>
            Позже
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const recommendedLimit = clampStoryContextLimit(contextBudgetWarning?.recommendedLimit ?? contextLimitChars)
              setContextBudgetWarning(null)
              void persistContextLimit(recommendedLimit)
            }}
            disabled={isSavingContextLimit}
            sx={{ textTransform: 'none' }}
          >
            Увеличить лимит
          </Button>
        </DialogActions>
      </BaseDialog>

      <BaseDialog
        open={environmentEditorOpen}
        onClose={() => {
          if (isSavingEnvironmentPanel) {
            return
          }
          setEnvironmentEditorOpen(false)
        }}
        maxWidth="md"
        transitionComponent={DialogTransition}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-dialog-bg)',
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.18rem' }}>Погода и время</Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.3 }}>
          <Stack spacing={1.2}>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', lineHeight: 1.45 }}>
              Здесь можно вручную задать место сцены, сезон, месяц, текущее время и текущую погоду. Время и погода работают независимо: можно оставить только одно из них активным.
            </Typography>

            <TextField
              label="Место"
              fullWidth
              value={environmentLocationDraft}
              onChange={(event) => setEnvironmentLocationDraft(event.target.value.slice(0, 160))}
              sx={environmentEditorFieldSx}
            />

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
              <TextField
                select
                label="Сезон"
                fullWidth
                value={environmentSeasonDraft}
                onChange={(event) => {
                  const nextSeason = event.target.value as EnvironmentSeasonValue
                  setEnvironmentSeasonDraft(nextSeason)
                  const availableMonths = resolveEnvironmentMonthOptionsForSeason(nextSeason)
                  if (!availableMonths.some((option) => option.value === environmentMonthDraft)) {
                    setEnvironmentMonthDraft(availableMonths[0]?.value ?? '6')
                  }
                }}
                sx={environmentEditorFieldSx}
              >
                {ENVIRONMENT_SEASON_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Месяц"
                fullWidth
                value={environmentMonthDraft}
                onChange={(event) => {
                  const nextMonth = event.target.value
                  setEnvironmentMonthDraft(nextMonth)
                  setEnvironmentSeasonDraft(resolveEnvironmentSeasonValueFromMonth(nextMonth))
                }}
                sx={environmentEditorFieldSx}
              >
                {resolveEnvironmentMonthOptionsForSeason(environmentSeasonDraft).map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Время"
                type="time"
                value={environmentTimeDraft}
                onChange={(event) => setEnvironmentTimeDraft(event.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ step: 60 }}
                sx={{ ...environmentEditorFieldSx, width: { xs: '100%', md: 180 } }}
              />
            </Stack>

            <Stack spacing={0.8}>
              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.96rem', fontWeight: 800 }}>
                Текущая погода
              </Typography>
              <TextField
                label="Погода сейчас"
                fullWidth
                value={environmentCurrentSummaryDraft}
                onChange={(event) => setEnvironmentCurrentSummaryDraft(event.target.value)}
                placeholder="Например: солнечно, дождливо, туманно"
                sx={environmentEditorFieldSx}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.4 }}>
          <Button
            onClick={() => setEnvironmentEditorOpen(false)}
            disabled={isSavingEnvironmentPanel || isRegeneratingEnvironmentWeather}
            sx={{
              minHeight: 38,
              borderRadius: '12px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              color: 'var(--morius-text-primary)',
              backgroundColor: 'var(--morius-elevated-bg)',
            }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => void handleSaveEnvironmentEditor()}
            disabled={isSavingEnvironmentPanel || isRegeneratingEnvironmentWeather}
            sx={{
              minHeight: 38,
              borderRadius: '12px',
              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 34%, var(--morius-card-border))',
              color: 'var(--morius-title-text)',
              backgroundColor: 'color-mix(in srgb, var(--morius-button-active) 32%, var(--morius-elevated-bg))',
            }}
          >
            {isSavingEnvironmentPanel ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogActions>
      </BaseDialog>

      <BaseDialog
        open={bugReportDialogOpen}
        onClose={handleCloseBugReportDialog}
        maxWidth="sm"
        transitionComponent={DialogTransition}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-dialog-bg)',
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
                backgroundColor: 'transparent',
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
        {cardMenuType === 'world' && characterStateEnabled && selectedMenuWorldCard && supportsWorldCardAiStateUi(selectedMenuWorldCard) ? (
          <MenuItem
            onClick={() => {
              void handleToggleWorldCardAiEdit()
            }}
            disabled={isWorldCardActionLocked || !selectedMenuWorldCard || isSelectedMenuWorldCardAiEditUpdating}
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            {isSelectedMenuWorldCardAiEditUpdating ? (
              <CircularProgress size={14} sx={{ color: 'rgba(220, 231, 245, 0.92)' }} />
            ) : (
              selectedMenuWorldCard ? getWorldCardAiEditActionLabel(selectedMenuWorldCard) : 'Авто состояние'
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
        {cardMenuType === 'plot' ? (
          <MenuItem
            onClick={() => {
              void handleTogglePlotCardEnabled()
            }}
            disabled={isPlotCardActionLocked || !selectedMenuPlotCard || isSelectedMenuPlotCardTriggerDriven}
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            {isSelectedMenuPlotCardTriggerDriven ? 'По триггерам' : selectedMenuPlotCard?.is_enabled ? 'Выключить' : 'Включить'}
          </MenuItem>
        ) : null}
        {cardMenuType !== null ? (
          <MenuItem
            onClick={handleCardMenuEdit}
            disabled={
              cardMenuType === null
                ? true
                : cardMenuType === 'instruction'
                  ? isInstructionCardActionLocked || isSelectedMenuInstructionActiveUpdating
                  : cardMenuType === 'plot'
                    ? isPlotCardActionLocked
                    : isWorldCardActionLocked || isSelectedMenuWorldCardLocked || isSelectedMenuWorldCardAiEditUpdating
            }
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            Редактировать
          </MenuItem>
        ) : null}
        {cardMenuType !== null ? (
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
                    ? isPlotCardActionLocked
                    : isWorldCardActionLocked || !canDeleteSelectedMenuWorldCard || isSelectedMenuWorldCardAiEditUpdating
            }
            sx={{ color: 'rgba(248, 176, 176, 0.94)', fontSize: '0.9rem' }}
          >
            Удалить
          </MenuItem>
        ) : null}
      </Menu>

      <AdvancedRegenerationDialog
        open={advancedRegenerationDialogOpen}
        selectedMode={selectedSmartRegenerationMode}
        selectedOptions={selectedSmartRegenerationOptions}
        disabled={isGenerating || isRerollTurnPendingReplacement}
        onClose={() => setAdvancedRegenerationDialogOpen(false)}
        onModeChange={setSelectedSmartRegenerationMode}
        onToggleOption={handleToggleSmartRegenerationOption}
        onDefaultRegenerate={handleDefaultRegenerationFromDialog}
        onSmartRegenerate={handleSmartRegenerationFromDialog}
      />

      <BaseDialog
        open={missingMainHeroDialogOpen}
        onClose={() => setMissingMainHeroDialogOpen(false)}
        maxWidth="sm"
        transitionComponent={DialogTransition}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-dialog-bg)',
        }}
        header={
          <Stack spacing={0.35}>
            <Typography sx={{ fontSize: '1.2rem', fontWeight: 800 }}>Выберите Главного Героя</Typography>
          </Stack>
        }
        actions={
          <Stack direction="row" spacing={0.8} justifyContent="flex-end" sx={{ width: '100%' }}>
            <Button
              onClick={() => {
                localStorage.setItem(MISSING_MAIN_HERO_DIALOG_SUPPRESS_KEY, '1')
                setMissingMainHeroDialogOpen(false)
              }}
              sx={{ color: 'var(--morius-text-secondary)' }}
            >
              Не напоминать
            </Button>
            <Button
              onClick={() => setMissingMainHeroDialogOpen(false)}
              sx={{
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-button-active)',
                color: 'var(--morius-text-primary)',
                '&:hover': {
                  backgroundColor: 'var(--morius-button-hover)',
                },
              }}
            >
              Продолжить
            </Button>
          </Stack>
        }
      >
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.94rem', lineHeight: 1.55 }}>
          Главный герой - то за кого вы играете. Он всегда есть в памяти модели чтобы она понимала за кого вы играете.
          Рекомендуем не оставлять его пустым.
        </Typography>
      </BaseDialog>

      <BaseDialog
        open={Boolean(deletionPrompt)}
        onClose={handleCancelDeletionPrompt}
        maxWidth="xs"
        transitionComponent={DialogTransition}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-dialog-bg)',
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
          backgroundColor: 'rgba(1, 4, 8, 0.88)',
        }}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-dialog-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: { xs: 'calc(100dvh - 18px)', sm: 'min(92vh, 960px)' },
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {editingInstructionId === null ? 'Новая инструкция' : 'Редактирование инструкции'}
          </Typography>
        </DialogTitle>
        <DialogContent className="morius-scrollbar" sx={{ pt: 0.3, overflowY: 'auto' }}>
          {false ? (
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
                label="Имя"
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
              '&:hover': { backgroundColor: 'transparent' },
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
          backgroundColor: 'rgba(1, 4, 8, 0.88)',
        }}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-dialog-bg)',
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
          {false ? (
            <Stack spacing={0.95}>
              <Stack spacing={0.7} alignItems="center">
                <Box
                  role="button"
                  tabIndex={editingWorldCard ? 0 : -1}
                  aria-label="change character avatar"
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
                label="Имя"
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
          )}
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
              '&:hover': { backgroundColor: 'transparent' },
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
          backgroundColor: 'rgba(1, 4, 8, 0.88)',
        }}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-dialog-bg)',
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
          {isCharacterWorldCardEditor ? (
            <Stack spacing={0.95}>
              <Stack spacing={0.7} alignItems="center">
                <Box
                  role="button"
                  tabIndex={editingWorldCard ? 0 : -1}
                  aria-label="change character avatar"
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
                label="Имя"
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
          )}
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
              '&:hover': { backgroundColor: 'transparent' },
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
          backgroundColor: 'rgba(1, 4, 8, 0.88)',
        }}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-dialog-bg)',
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
            {mainHeroCard && characterStateEnabled ? (
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
            <Typography sx={{ color: 'var(--morius-accent)', fontSize: '0.8rem', lineHeight: 1.35 }}>
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
        disableBackdropClose
        protectTextInputClose={false}
        maxWidth="sm"
        transitionComponent={DialogTransition}
        backdropSx={{
          backgroundColor: 'rgba(1, 4, 8, 0.88)',
        }}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-dialog-bg)',
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
              : editingWorldCardKind === 'world_profile'
                ? editingWorldCardId === null
                  ? 'Описание мира'
                  : 'Редактирование описания мира'
                : editingWorldCardId === null
                  ? 'Новая деталь мира'
                  : 'Редактирование детали мира'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.3 }}>
          {isCharacterWorldCardEditor ? (
            <Stack spacing={0.95}>
              <Stack spacing={0.7} alignItems="center">
                <Box
                  role="button"
                  tabIndex={editingWorldCard ? 0 : -1}
                  aria-label="change character avatar"
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
                    fallbackLabel={worldCardTitleDraft || '\u041f\u0435\u0440\u0441\u043e\u043d\u0430\u0436'}
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
              <Autocomplete<CharacterRaceOption, false, false, false>
                options={worldCardRaceOptions}
                value={selectedWorldCardRaceOption}
                inputValue={worldCardRaceInputDraft}
                onInputChange={(_event, nextValue, reason) => {
                  if (reason === 'reset') {
                    setWorldCardRaceInputDraft(selectedWorldCardRaceOption?.value ?? '')
                    return
                  }
                  setWorldCardRaceInputDraft(nextValue.slice(0, STORY_CHARACTER_RACE_MAX_LENGTH))
                }}
                onChange={(event, nextValue) => {
                  void handleWorldCardRaceSelectionChange(event, nextValue)
                }}
                filterOptions={(options, params) => {
                  const filtered = filterCharacterRaceOptions(options, params)
                  const normalizedInputValue = normalizeCharacterRaceValue(params.inputValue)
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
                isOptionEqualToValue={(option, value) => option.value === value.value && option.isCreateAction === value.isCreateAction}
                loading={isLoadingCharacterRaces || isSavingCharacterRace}
                disabled={isWorldCardActionLocked}
                fullWidth
                noOptionsText="Расы не найдены"
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Раса"
                    placeholder="Выберите или добавьте расу"
                    inputProps={{
                      ...params.inputProps,
                    }}
                    helperText={<TextLimitIndicator currentLength={normalizedWorldCardRaceInputDraft.length} maxLength={STORY_CHARACTER_RACE_MAX_LENGTH} />}
                    FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {isLoadingCharacterRaces || isSavingCharacterRace ? (
                            <CircularProgress color="inherit" size={16} />
                          ) : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
              <TextField
                label={'\u0418\u043c\u044f'}
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
                label={'\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435'}
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
              <Box sx={{ borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)', pt: 0.2 }}>
                <Button
                  onClick={() => setIsWorldCardAdditionalExpanded((previous) => !previous)}
                  sx={{
                    width: '100%',
                    minHeight: 42,
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
                  <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.95rem', fontWeight: 700 }}>
                    Дополнительно
                  </Typography>
                  <SvgIcon
                    sx={{
                      fontSize: 21,
                      color: 'var(--morius-text-secondary)',
                      transform: isWorldCardAdditionalExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 200ms ease',
                    }}
                  >
                    <path d="M7.41 8.59 12 13.17 16.59 8.59 18 10l-6 6-6-6z" />
                  </SvgIcon>
                </Button>
                <Collapse in={isWorldCardAdditionalExpanded} timeout={200} unmountOnExit>
                  <Stack spacing={0.95} sx={{ pt: 0.35 }}>
                    <TextField
                      label="Одежда"
                      value={worldCardClothingDraft}
                      onChange={(event) => setWorldCardClothingDraft(event.target.value.slice(0, STORY_CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH))}
                      fullWidth
                      multiline
                      minRows={2}
                      maxRows={5}
                      disabled={isWorldCardActionLocked}
                      inputProps={{ maxLength: STORY_CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH }}
                      helperText={<TextLimitIndicator currentLength={worldCardClothingDraft.length} maxLength={STORY_CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH} />}
                      FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                    />
                    <TextField
                      label="Инвентарь"
                      value={worldCardInventoryDraft}
                      onChange={(event) => setWorldCardInventoryDraft(event.target.value.slice(0, STORY_CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH))}
                      fullWidth
                      multiline
                      minRows={2}
                      maxRows={5}
                      disabled={isWorldCardActionLocked}
                      inputProps={{ maxLength: STORY_CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH }}
                      helperText={<TextLimitIndicator currentLength={worldCardInventoryDraft.length} maxLength={STORY_CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH} />}
                      FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                    />
                    <TextField
                      label="Состояние здоровья"
                      value={worldCardHealthStatusDraft}
                      onChange={(event) => setWorldCardHealthStatusDraft(event.target.value.slice(0, STORY_CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH))}
                      fullWidth
                      multiline
                      minRows={2}
                      maxRows={5}
                      disabled={isWorldCardActionLocked}
                      inputProps={{ maxLength: STORY_CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH }}
                      helperText={<TextLimitIndicator currentLength={worldCardHealthStatusDraft.length} maxLength={STORY_CHARACTER_ADDITIONAL_FIELD_MAX_LENGTH} />}
                      FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                    />
                  </Stack>
                </Collapse>
              </Box>
              <TextField
                label={'\u0422\u0440\u0438\u0433\u0433\u0435\u0440\u044b'}
                value={worldCardTriggersDraft}
                onChange={(event) => setWorldCardTriggersDraft(event.target.value.slice(0, STORY_TRIGGER_INPUT_MAX_LENGTH))}
                fullWidth
                multiline
                minRows={2}
                maxRows={4}
                disabled={isWorldCardActionLocked}
                placeholder={'\u0447\u0435\u0440\u0435\u0437 \u0437\u0430\u043f\u044f\u0442\u0443\u044e'}
                inputProps={{ maxLength: STORY_TRIGGER_INPUT_MAX_LENGTH }}
                helperText={<TextLimitIndicator currentLength={worldCardTriggersDraft.length} maxLength={STORY_TRIGGER_INPUT_MAX_LENGTH} />}
                FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
              />
              {editingWorldCardKind === 'npc' ? (
                <Stack spacing={0.35}>
                  <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.82rem' }}>
                    {'\u041f\u0430\u043c\u044f\u0442\u044c NPC \u0432 \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442\u0435'}
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
                    <option value="off">{'\u041e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u043e'}</option>
                    <option value="3">{'\u0033 \u0445\u043e\u0434\u0430'}</option>
                    <option value="5">{'\u0035 \u0445\u043e\u0434\u043e\u0432'}</option>
                    <option value="10">{'\u0031\u0030 \u0445\u043e\u0434\u043e\u0432'}</option>
                    <option value="always">{'\u041f\u043e\u043c\u043d\u0438\u0442\u044c \u0432\u0441\u0435\u0433\u0434\u0430'}</option>
                  </Box>
                </Stack>
              ) : null}
            </Stack>
          ) : (
            <Stack spacing={1.05}>
              <WorldCardBannerPreview
                imageUrl={editingWorldCardPreviewAvatarUrl}
                imageScale={worldCardAvatarScaleDraft || 1}
                title="Баннер карточки"
                description="Добавьте широкое изображение для мира или детали, чтобы карточка выглядела как баннер."
                actionLabel="Выбрать баннер"
                disabled={isWorldCardActionLocked || isSavingWorldCardAvatar}
                loading={isSavingWorldCardAvatar}
                onClick={() => handleOpenWorldCardAvatarPicker(editingWorldCardId, 'draft')}
              />

              {editingWorldCardKind === 'world' ? (
                <Autocomplete<WorldDetailTypeAutocompleteOption, false, false, false>
                  options={worldDetailTypeAutocompleteOptions}
                  value={selectedWorldCardDetailTypeOption}
                  inputValue={worldCardDetailTypeDraft}
                  onInputChange={(_event, nextValue, reason) => {
                    if (reason === 'reset') {
                      setWorldCardDetailTypeDraft(selectedWorldCardDetailTypeOption?.value ?? '')
                      return
                    }
                    setWorldCardDetailTypeDraft(nextValue.slice(0, STORY_CHARACTER_RACE_MAX_LENGTH))
                  }}
                  onChange={(event, nextValue) => {
                    void handleWorldCardDetailTypeSelectionChange(event, nextValue)
                  }}
                  filterOptions={(options, params) => {
                    const filtered = filterWorldDetailTypeOptions(options, params)
                    const normalizedInputValue = normalizeStoryWorldDetailTypeValue(params.inputValue)
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
                  isOptionEqualToValue={(option, value) => option.value === value.value && option.isCreateAction === value.isCreateAction}
                  loading={isLoadingWorldDetailTypes || isSavingWorldDetailType}
                  disabled={isWorldCardActionLocked}
                  fullWidth
                  noOptionsText="Типы не найдены"
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Тип"
                      placeholder="Место, предмет, заклинание, моб..."
                      inputProps={{
                        ...params.inputProps,
                        maxLength: STORY_CHARACTER_RACE_MAX_LENGTH,
                      }}
                      helperText={<TextLimitIndicator currentLength={normalizedWorldCardDetailTypeDraft.length} maxLength={STORY_CHARACTER_RACE_MAX_LENGTH} />}
                      FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                      InputProps={{
                        ...params.InputProps,
                        endAdornment: (
                          <>
                            {isLoadingWorldDetailTypes || isSavingWorldDetailType ? (
                              <CircularProgress color="inherit" size={16} />
                            ) : null}
                            {params.InputProps.endAdornment}
                          </>
                        ),
                      }}
                    />
                  )}
                />
              ) : null}

              <TextField
                label={editingWorldCardKind === 'world_profile' ? 'Название мира' : 'Название детали'}
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
                label={editingWorldCardKind === 'world_profile' ? 'Описание мира' : 'Описание'}
                value={worldCardContentDraft}
                onChange={(event) => setWorldCardContentDraft(event.target.value.slice(0, WORLD_CARD_CONTENT_MAX_LENGTH))}
                fullWidth
                multiline
                minRows={editingWorldCardKind === 'world_profile' ? 6 : 4}
                maxRows={editingWorldCardKind === 'world_profile' ? 12 : 8}
                disabled={isWorldCardActionLocked}
                placeholder={
                  editingWorldCardKind === 'world_profile'
                    ? 'Опишите лор мира, правила, эпоху, магию, технологии, расы и всё, что рассказчик должен помнить всегда.'
                    : 'Опишите место, предмет, заклинание, моба или другую важную деталь мира.'
                }
                inputProps={{ maxLength: WORLD_CARD_CONTENT_MAX_LENGTH }}
                helperText={<TextLimitIndicator currentLength={worldCardContentDraft.length} maxLength={WORLD_CARD_CONTENT_MAX_LENGTH} />}
                FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
              />

              {editingWorldCardKind === 'world_profile' ? <Box sx={{ display: 'none' }} /> : (
                <>
                  <TextField
                    label="Триггеры"
                    value={worldCardTriggersDraft}
                    onChange={(event) => setWorldCardTriggersDraft(event.target.value.slice(0, STORY_TRIGGER_INPUT_MAX_LENGTH))}
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={4}
                    disabled={isWorldCardActionLocked}
                    placeholder="Через запятую: храм, артефакт, некромантия"
                    inputProps={{ maxLength: STORY_TRIGGER_INPUT_MAX_LENGTH }}
                    helperText={<TextLimitIndicator currentLength={worldCardTriggersDraft.length} maxLength={STORY_TRIGGER_INPUT_MAX_LENGTH} />}
                    FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                  />

                  <Stack spacing={0.35}>
                    <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.82rem' }}>
                      Память детали в контексте
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
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
          <Button
            onClick={handleCloseWorldCardDialog}
            disabled={isSavingWorldCard || isCreatingGame}
            sx={{ color: 'var(--morius-title-text)' }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => void handleSaveWorldCard()}
            disabled={isSavingWorldCard || isCreatingGame}
            sx={{
              color: 'var(--morius-accent)',
              minWidth: 118,
            }}
          >
            {isSavingWorldCard || isCreatingGame ? (
              <CircularProgress size={16} sx={{ color: 'var(--morius-accent)' }} />
            ) : editingWorldCardId === null ? (
              'Добавить'
            ) : (
              'Сохранить'
            )}
          </Button>
        </DialogActions>
      </BaseDialog>

      <BaseDialog
        open={worldCardCloseConfirmOpen}
        onClose={() => setWorldCardCloseConfirmOpen(false)}
        maxWidth="xs"
        header={<Typography sx={{ fontWeight: 800 }}>Закрыть без сохранения?</Typography>}
        contentSx={{ color: 'var(--morius-text-secondary)', pt: 0.5 }}
        actions={
          <>
            <Button onClick={() => setWorldCardCloseConfirmOpen(false)} sx={{ color: 'var(--morius-text-secondary)' }}>
              Остаться
            </Button>
            <Button onClick={forceCloseWorldCardDialog} sx={{ color: 'var(--morius-title-text)' }}>
              Закрыть
            </Button>
          </>
        }
      >
        Внесенные изменения будут потеряны.
      </BaseDialog>

      <WorldCardTemplatePickerDialog
        open={worldCardTemplatePickerOpen}
        authToken={authToken}
        kind={worldCardTemplatePickerKind}
        title={worldCardTemplatePickerKind === 'world_profile' ? 'Шаблоны описания мира' : 'Шаблоны деталей мира'}
        emptyTitle={worldCardTemplatePickerKind === 'world_profile' ? 'Шаблонов мира пока нет' : 'Шаблонов деталей пока нет'}
        emptyDescription={
          worldCardTemplatePickerKind === 'world_profile'
            ? 'Создайте карточки мира в профиле, чтобы быстро применять их в новых историях.'
            : 'Создайте шаблоны мест, предметов, мобов и других деталей мира в профиле.'
        }
        onClose={() => setWorldCardTemplatePickerOpen(false)}
        onSelectTemplate={(template) => {
          void handleApplyWorldCardTemplate(template)
        }}
      />

      <CharacterManagerDialog
        open={characterManagerDialogOpen}
        authToken={authToken}
        initialMode={characterManagerInitialMode}
        initialCharacterId={characterManagerInitialCharacterId}
        showEmotionTools={user.role === 'administrator'}
        extraEditorContent={
          shouldShowCharacterManagerNpcMemoryEditor ? (
            <Stack spacing={0.35}>
              <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.82rem', fontWeight: 700 }}>
                Память NPC в контексте
              </Typography>
              <Box
                component="select"
                value={
                  characterManagerSyncCardMemoryTurnsDraft === null
                    ? 'always'
                    : characterManagerSyncCardMemoryTurnsDraft === NPC_WORLD_CARD_MEMORY_TURNS_DISABLED
                      ? 'off'
                      : String(characterManagerSyncCardMemoryTurnsDraft)
                }
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  const nextValue = event.target.value
                  if (nextValue === 'always') {
                    setCharacterManagerSyncCardMemoryTurnsDraft(null)
                    return
                  }
                  if (nextValue === 'off') {
                    setCharacterManagerSyncCardMemoryTurnsDraft(NPC_WORLD_CARD_MEMORY_TURNS_DISABLED)
                    return
                  }
                  setCharacterManagerSyncCardMemoryTurnsDraft(Number(nextValue) as NpcMemoryTurnsOption)
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
          ) : null
        }
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
          backgroundColor: 'rgba(1, 4, 8, 0.88)',
        }}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-dialog-bg)',
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
                        ?
                      </Box>
                    </Box>
                  </Box>
                </Stack>
                <Stack spacing={0.8} sx={{ flex: 1 }}>
                  <Box
                    component="input"
                    value={characterNameDraft}
                    placeholder="Имя"
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
                        '&:hover .morius-overflow-action, &:focus-within .morius-overflow-action': {
                          opacity: 1,
                          pointerEvents: 'auto',
                        },
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
                        <Stack sx={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }} spacing={0.34}>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
                            <Typography sx={{ color: 'var(--morius-title-text)', fontWeight: 700, fontSize: '0.94rem', minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{character.name}</Typography>
                          </Stack>
                          {character.note ? <CharacterNoteBadge note={character.note} maxWidth={98} /> : null}
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
                          className="morius-overflow-action"
                          onClick={(event) => handleOpenCharacterItemMenu(event, character.id)}
                          disabled={isSavingCharacter || deletingCharacterId === character.id}
                          sx={{ ...overflowActionButtonSx, flexShrink: 0 }}
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
                    '&:hover': { backgroundColor: 'transparent' },
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
                    '&:hover': { backgroundColor: 'transparent' },
                  }}
                >
                  Сообщество
                </Button>
              </Stack>
              <Box
                component="input"
                value={characterSelectionSearchQuery}
                placeholder="Поиск по имени, расе, описанию, заметкам, триггерам и автору"
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
                            backgroundColor: 'transparent',
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
                            <Stack spacing={0.34} sx={{ minWidth: 0, alignItems: 'flex-start' }}>
                              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
                                <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: 'var(--morius-title-text)', minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {character.name}
                                </Typography>
                              </Stack>
                              {character.note ? <CharacterNoteBadge note={character.note} maxWidth={98} /> : null}
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
                              <Stack spacing={0.34} sx={{ minWidth: 0, flex: 1, alignItems: 'flex-start' }}>
                                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
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
                                </Stack>
                                {character.note ? <CharacterNoteBadge note={character.note} maxWidth={98} /> : null}
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
                                    '&:hover': { backgroundColor: 'transparent' },
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
                                    '&:hover': { backgroundColor: 'transparent' },
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
                                    '&:hover': { backgroundColor: 'transparent' },
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
          backgroundColor: 'rgba(1, 4, 8, 0.88)',
        }}
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-dialog-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.2rem' }}>
            {openedAiMemoryBlock ? `#${openedAiMemoryBlock.id} · ${openedAiMemoryBlock.title}` : 'Блок памяти'}
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
            <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>?</Box>
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
            <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>?</Box>
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
              maxHeight: '85vh',
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
        onUserUpdate={onUserUpdate}
      />

      <TopUpDialog
        open={topUpDialogOpen}
        topUpError={topUpError}
        isTopUpPlansLoading={isTopUpPlansLoading}
        topUpPlans={topUpPlans}
        activePlanPurchaseId={activePlanPurchaseId}
        authToken={authToken}
        transitionComponent={DialogTransition}
        onClose={handleCloseTopUpDialog}
        onPurchasePlan={(planId) => void handlePurchasePlan(planId)}
      />

      <PaymentSuccessDialog
        open={paymentSuccessCoins !== null}
        coins={paymentSuccessCoins ?? 0}
        referralBonusCoins={paymentReferralBonusCoins}
        transitionComponent={DialogTransition}
        onClose={() => {
          setPaymentSuccessCoins(null)
          setPaymentReferralBonusCoins(0)
        }}
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
      {worldCardAvatarCropSource && isCharacterWorldCardEditor ? (
        <AvatarCropDialog
          open={Boolean(worldCardAvatarCropSource)}
          imageSrc={worldCardAvatarCropSource}
          isSaving={isSavingWorldCardAvatar}
          outputSize={384}
          onCancel={() => {
            if (!isSavingWorldCardAvatar) {
              setWorldCardAvatarCropSource(null)
              setWorldCardAvatarTargetId(null)
              setWorldCardAvatarTargetMode(null)
            }
          }}
          onSave={(croppedDataUrl) => void handleSaveCroppedWorldCardAvatar(croppedDataUrl)}
        />
      ) : null}
      {worldCardAvatarCropSource && !isCharacterWorldCardEditor ? (
        <ImageCropper
          imageSrc={worldCardAvatarCropSource}
          aspect={STORY_WORLD_BANNER_ASPECT}
          frameRadius={20}
          title="Настройка баннера карточки"
          isSaving={isSavingWorldCardAvatar}
          onCancel={() => {
            if (!isSavingWorldCardAvatar) {
              setWorldCardAvatarCropSource(null)
              setWorldCardAvatarTargetId(null)
              setWorldCardAvatarTargetMode(null)
            }
          }}
          onSave={(croppedDataUrl) => void handleSaveCroppedWorldCardAvatar(croppedDataUrl)}
        />
      ) : null}
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
