import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Alert, Box, Button, CircularProgress, IconButton, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { icons } from '../assets'
import AppHeader from '../components/AppHeader'
import CharacterNoteBadge from '../components/characters/CharacterNoteBadge'
import CharacterShowcaseCard from '../components/characters/CharacterShowcaseCard'
import HeaderAccountActions from '../components/HeaderAccountActions'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import TopUpDialog from '../components/profile/TopUpDialog'
import WorldCardTemplatePickerDialog from '../components/story/WorldCardTemplatePickerDialog'
import WorldCardBannerPreview from '../components/story/WorldCardBannerPreview'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import BaseDialog from '../components/dialogs/BaseDialog'
import FormDialog from '../components/dialogs/FormDialog'
import ImageCropper from '../components/ImageCropper'
import TextLimitIndicator from '../components/TextLimitIndicator'
import ProgressiveAvatar from '../components/media/ProgressiveAvatar'
import { QUICK_START_WORLD_STORAGE_KEY } from '../constants/storageKeys'
import { buildUnifiedMobileQuickActions } from '../utils/mobileQuickActions'
import { STORY_WORLD_BANNER_ASPECT } from '../utils/storyWorldCards'
import {
  createCoinTopUpPayment,
  getCoinTopUpPlans,
  type CoinTopUpPlan,
} from '../services/authApi'
import {
  addCommunityCharacter,
  createStoryCharacter,
  createStoryGame,
  createStoryInstructionCard,
  createStoryPlotCard,
  createStoryWorldCard,
  deleteStoryInstructionCard,
  deleteStoryPlotCard,
  deleteStoryWorldCard,
  getCommunityCharacter,
  getStoryGame,
  listCommunityCharacters,
  listStoryCharacters,
  updateStoryGameMeta,
  updateStoryInstructionCard,
  updateStoryPlotCard,
  updateStoryWorldCard,
  updateStoryWorldCardAvatar,
} from '../services/storyApi'
import { loadStoryTitleMap, persistStoryTitleMap, setStoryTitle } from '../services/storyTitleStore'
import { moriusThemeTokens } from '../theme'
import type { AuthUser } from '../types/auth'
import type {
  StoryCharacter,
  StoryCharacterEmotionAssets,
  StoryCommunityCharacterSummary,
  StoryGameVisibility,
  StoryWorldCard,
  StoryWorldCardTemplate,
} from '../types/story'
import {
  compressImageDataUrl,
  compressImageFileToDataUrl,
  getJsonDataUrlRequestSafeMaxBytes,
  prepareAvatarUrlForRequest,
} from '../utils/avatar'
import { resolvePublicationDraftVisibility } from '../utils/publication'

type WorldCreatePageProps = {
  user: AuthUser
  authToken: string
  editingGameId?: number | null
  editSource?: 'my-games' | 'my-publications' | null
  onNavigate: (path: string) => void
}

type EditableCard = {
  localId: string
  id?: number
  title: string
  content: string
  triggers?: string
  is_enabled?: boolean
}

type EditableCharacterCard = {
  localId: string
  id?: number
  character_id: number | null
  source_character_id: number | null
  name: string
  description: string
  race: string
  clothing: string
  inventory: string
  health_status: string
  note: string
  triggers: string
  avatar_url: string | null
  avatar_original_url: string | null
  avatar_scale: number
  emotion_assets: StoryCharacterEmotionAssets
  emotion_model: string
  emotion_prompt_lock: string | null
}

type EditableWorldProfileCard = {
  id?: number
  title: string
  content: string
  avatar_url: string | null
  avatar_original_url: string | null
  avatar_scale: number
}

type CharacterPickerSourceTab = 'my' | 'community'
type CommunityAddedFilter = 'all' | 'added' | 'not_added'
type CommunitySortMode = 'updated_desc' | 'rating_desc' | 'additions_desc'
type CharacterManagerSyncTarget = {
  target: 'main_hero' | 'npc'
  localId: string
}

const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const APP_BUTTON_ACTIVE = 'var(--morius-button-active)'
const OPENING_SCENE_TAG_BUTTON_SX = {
  minHeight: 30,
  borderRadius: '10px',
  textTransform: 'none',
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'var(--morius-accent)',
  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
  backgroundColor: 'transparent',
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
}
const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const AVATAR_SCALE_MIN = 1
const AVATAR_SCALE_MAX = 3
const COVER_MAX_BYTES = 2 * 1024 * 1024
const CHARACTER_AVATAR_MAX_BYTES = 2 * 1024 * 1024
const WORLD_PROFILE_BANNER_MAX_BYTES = 2 * 1024 * 1024
const CARD_WIDTH = 286
const WORLD_PROFILE_TITLE_MAX_LENGTH = 120
const WORLD_PROFILE_CONTENT_MAX_LENGTH = 8000
const AGE_RATING_OPTIONS = ['6+', '16+', '18+'] as const
const MAX_WORLD_GENRES = 3
const OPENING_SCENE_MAX_LENGTH = 4_000
const OPENING_SCENE_NPC_NAME_MAX_LENGTH = 120
const OPENING_SCENE_NPC_FALLBACK_NAME = 'NPC'
const OPENING_SCENE_GG_FALLBACK_NAME = 'Главный Герой'
const STORY_TRIGGER_INPUT_MAX_LENGTH = 600
const COMMUNITY_FEED_CACHE_KEY_PREFIX = 'morius.community.feed.cache.v1'
const PLOT_GG_INLINE_TAG_PATTERN = /\[\[\s*GG(?:\s*:\s*([^\]]+?))?\s*\]\]/giu
const CHARACTER_NOTE_MAX_LENGTH = 20
const WORLD_GENRE_OPTIONS = [
  'Фэнтези',
  'Фантастика (Научная фантастика)',
  'Детектив',
  'Триллер',
  'Хоррор (Ужасы)',
  'Мистика',
  'Романтика (Любовный роман)',
  'Приключения',
  'Боевик',
  'Исторический роман',
  'Комедия / Юмор',
  'Трагедия / Драма',
  'Антиутопия',
  'Постапокалипсис',
  'Киберпанк',
  'Повседневность',
] as const
type StoryAgeRating = (typeof AGE_RATING_OPTIONS)[number]

const dialogPaperSx = {
  borderRadius: 'var(--morius-radius)',
  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
  background: 'var(--morius-dialog-bg)',
  boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
}

function makeLocalId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseTriggers(value: string, fallback: string): string[] {
  const unique = Array.from(new Set(value.split(/[\n,]/g).map((item) => item.trim()).filter(Boolean)))
  if (unique.length > 0) {
    return unique
  }
  return fallback.trim() ? [fallback.trim()] : []
}

function parseOptionalTriggers(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,;]+/g).map((item) => item.trim()).filter(Boolean)))
}

function normalizeCharacterNote(value: string): string {
  return value
    .replace(/\r\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHARACTER_NOTE_MAX_LENGTH)
}

function normalizeCharacterRace(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function normalizeCharacterAdditionalField(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, 1000)
}

function normalizeMainHeroInlineFallbackName(rawValue: string | null | undefined): string {
  const normalizedValue = (rawValue ?? '').replace(/\s+/g, ' ').trim()
  if (!normalizedValue) {
    return OPENING_SCENE_GG_FALLBACK_NAME
  }
  return normalizedValue.toLowerCase().replace(/ё/g, 'е') === 'главный герой'
    ? OPENING_SCENE_GG_FALLBACK_NAME
    : normalizedValue
}

function replacePlotMainHeroTags(value: string, rawMainHeroName: string | null | undefined): string {
  if (!value || !value.includes('[[')) {
    return value
  }
  const normalizedMainHeroName = (rawMainHeroName ?? '').replace(/\s+/g, ' ').trim()
  return value.replace(PLOT_GG_INLINE_TAG_PATTERN, (_fullMatch, inlineFallbackName: string | undefined) => {
    if (normalizedMainHeroName) {
      return normalizedMainHeroName
    }
    return normalizeMainHeroInlineFallbackName(inlineFallbackName)
  })
}

function createInstructionTemplateSignature(title: string, content: string): string {
  const normalizedTitle = title.replace(/\s+/g, ' ').trim().toLowerCase()
  const normalizedContent = content.replace(/\s+/g, ' ').trim().toLowerCase()
  return `${normalizedTitle}::${normalizedContent}`
}

function buildCommunityFeedCacheKey(userId: number): string {
  return `${COMMUNITY_FEED_CACHE_KEY_PREFIX}:${userId}`
}

function normalizeCharacterIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^0-9a-zа-яё\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toEditableCharacterFromTemplate(character: StoryCharacter): EditableCharacterCard {
  return {
    localId: makeLocalId(),
    character_id: character.id,
    source_character_id: character.source_character_id ?? null,
    name: character.name,
    description: character.description,
    race: normalizeCharacterRace(character.race),
    clothing: normalizeCharacterAdditionalField(character.clothing),
    inventory: normalizeCharacterAdditionalField(character.inventory),
    health_status: normalizeCharacterAdditionalField(character.health_status),
    note: normalizeCharacterNote(character.note),
    triggers: character.triggers.join(', '),
    avatar_url: character.avatar_url,
    avatar_original_url: character.avatar_original_url ?? character.avatar_url,
    avatar_scale: clamp(character.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
    emotion_assets: character.emotion_assets ?? {},
    emotion_model: character.emotion_model ?? '',
    emotion_prompt_lock: character.emotion_prompt_lock ?? null,
  }
}

function toEditableCharacterFromCommunity(
  character: StoryCommunityCharacterSummary,
  profileCharacterId: number | null = null,
): EditableCharacterCard {
  return {
    localId: makeLocalId(),
    character_id: profileCharacterId,
    source_character_id: character.id,
    name: character.name,
    description: character.description,
    race: normalizeCharacterRace(character.race),
    clothing: normalizeCharacterAdditionalField(character.clothing),
    inventory: normalizeCharacterAdditionalField(character.inventory),
    health_status: normalizeCharacterAdditionalField(character.health_status),
    note: normalizeCharacterNote(character.note),
    triggers: character.triggers.join(', '),
    avatar_url: character.avatar_url,
    avatar_original_url: character.avatar_original_url ?? character.avatar_url,
    avatar_scale: clamp(character.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
    emotion_assets: character.emotion_assets ?? {},
    emotion_model: character.emotion_model ?? '',
    emotion_prompt_lock: character.emotion_prompt_lock ?? null,
  }
}

function toEditableCharacterFromWorldCard(card: StoryWorldCard): EditableCharacterCard {
  return {
    localId: makeLocalId(),
    id: card.id,
    character_id: card.character_id ?? null,
    source_character_id: null,
    name: card.title,
    description: card.content,
    race: normalizeCharacterRace(card.race),
    clothing: normalizeCharacterAdditionalField(card.clothing),
    inventory: normalizeCharacterAdditionalField(card.inventory),
    health_status: normalizeCharacterAdditionalField(card.health_status),
    note: '',
    triggers: card.triggers.join(', '),
    avatar_url: card.avatar_url,
    avatar_original_url: card.avatar_original_url ?? card.avatar_url,
    avatar_scale: clamp(card.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
    emotion_assets: {},
    emotion_model: '',
    emotion_prompt_lock: null,
  }
}

function toEditableWorldProfileFromWorldCard(card: StoryWorldCard): EditableWorldProfileCard {
  return {
    id: card.id,
    title: card.title,
    content: card.content,
    avatar_url: card.avatar_url,
    avatar_original_url: card.avatar_original_url ?? card.avatar_url,
    avatar_scale: clamp(card.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
  }
}

function toEditableWorldProfileFromTemplate(
  template: StoryWorldCardTemplate,
  existingId: number | undefined,
): EditableWorldProfileCard {
  return {
    id: existingId,
    title: template.title,
    content: template.content,
    avatar_url: template.avatar_url,
    avatar_original_url: template.avatar_original_url ?? template.avatar_url,
    avatar_scale: clamp(template.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
  }
}

function MiniAvatar({ avatarUrl, avatarScale, label, size = 52 }: { avatarUrl: string | null; avatarScale: number; label: string; size?: number }) {
  return (
    <ProgressiveAvatar
      src={avatarUrl}
      fallbackLabel={label}
      alt={label}
      size={size}
      scale={clamp(avatarScale, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX)}
      sx={{ flexShrink: 0 }}
    />
  )
}

function CompactCard({
  title,
  content,
  badge,
  noteBadge,
  avatar,
  actions,
}: {
  title: string
  content: string
  badge?: string
  noteBadge?: string
  avatar?: ReactNode
  actions?: ReactNode
}) {
  return (
    <Box sx={{ width: { xs: '100%', sm: CARD_WIDTH }, minHeight: 186, borderRadius: 'var(--morius-radius)', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, background: 'var(--morius-elevated-bg)', boxShadow: '0 12px 28px rgba(0, 0, 0, 0.24)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 1.1, py: 0.85, borderBottom: 'var(--morius-border-width) solid var(--morius-card-border)', background: 'var(--morius-card-bg)' }}>
        <Stack spacing={0.52}>
          <Stack direction="row" spacing={0.7} alignItems="center">
            {avatar}
            <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 800, fontSize: '1rem', lineHeight: 1.2, minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</Typography>
            {badge ? <Typography sx={{ color: 'rgba(170, 238, 191, 0.96)', fontSize: '0.63rem', lineHeight: 1, letterSpacing: 0.22, textTransform: 'uppercase', fontWeight: 700, border: 'var(--morius-border-width) solid rgba(128, 213, 162, 0.46)', borderRadius: '999px', px: 0.58, py: 0.18, flexShrink: 0 }}>{badge}</Typography> : null}
          </Stack>
          {noteBadge ? <CharacterNoteBadge note={noteBadge} maxWidth={132} /> : null}
        </Stack>
      </Box>
      <Box sx={{ px: 1.1, py: 0.9, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Typography sx={{ color: 'rgba(208, 219, 235, 0.88)', fontSize: '0.86rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{content}</Typography>
        {actions ? <Stack direction="row" spacing={0.7} sx={{ mt: 'auto', pt: 0.9 }}>{actions}</Stack> : null}
      </Box>
    </Box>
  )
}

type EmptyAddAction = {
  label: string
  onClick: () => void
}

function EmptyAddCard({ onClick, label, actions = [] }: { onClick: () => void; label: string; actions?: EmptyAddAction[] }) {
  return (
    <Box
      sx={{
        width: { xs: '100%', sm: 380 },
        minHeight: 186,
        borderRadius: '12px',
        border: 'var(--morius-border-width) dashed color-mix(in srgb, var(--morius-card-border) 78%, rgba(174, 201, 231, 0.34))',
        background:
          'linear-gradient(120deg, color-mix(in srgb, var(--morius-elevated-bg) 84%, #1a2634) 0%, color-mix(in srgb, var(--morius-card-bg) 82%, #2c3646) 100%)',
        color: APP_TEXT_PRIMARY,
        px: 1.15,
        py: 1.2,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 1,
      }}
    >
      <Button
        onClick={onClick}
        sx={{
          width: '100%',
          minHeight: 110,
          borderRadius: '10px',
          textTransform: 'none',
          backgroundColor: 'transparent',
          '&:hover': {
            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 66%, transparent)',
          },
        }}
      >
        <Stack alignItems="center" spacing={0.9}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-text-primary) 60%, transparent)',
              display: 'grid',
              placeItems: 'center',
              color: 'color-mix(in srgb, var(--morius-text-primary) 82%, #d9ecff)',
              fontSize: '2rem',
              lineHeight: 1,
            }}
          >
            +
          </Box>
          <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.84rem', fontWeight: 600 }}>{label}</Typography>
        </Stack>
      </Button>
      {actions.length > 0 ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7} sx={{ width: '100%' }}>
          {actions.slice(0, 2).map((action) => (
            <Button
              key={action.label}
              onClick={action.onClick}
              sx={{
                minHeight: 34,
                flex: 1,
                borderRadius: '999px',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                textTransform: 'none',
                fontSize: '0.83rem',
                backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 86%, transparent)',
              }}
            >
              {action.label}
            </Button>
          ))}
        </Stack>
      ) : null}
    </Box>
  )
}

function TemplateButtonsCard({
  title,
  subtitle,
  onCreate,
  onTemplate,
}: {
  title: string
  subtitle?: string
  onCreate: () => void
  onTemplate: () => void
}) {
  return (
    <Box
      sx={{
        width: { xs: '100%', sm: 380 },
        borderRadius: '12px',
        border: 'var(--morius-border-width) dashed color-mix(in srgb, var(--morius-card-border) 78%, rgba(174, 201, 231, 0.34))',
        background:
          'linear-gradient(120deg, color-mix(in srgb, var(--morius-elevated-bg) 84%, #1a2634) 0%, color-mix(in srgb, var(--morius-card-bg) 82%, #2c3646) 100%)',
        color: APP_TEXT_PRIMARY,
        px: 1.15,
        py: 1.05,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.85,
      }}
    >
      <Stack spacing={0.35}>
        <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '0.92rem', fontWeight: 700, lineHeight: 1.2 }}>{title}</Typography>
        {subtitle ? <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.78rem', lineHeight: 1.35 }}>{subtitle}</Typography> : null}
      </Stack>
      <Stack direction="row" spacing={0.7} sx={{ width: '100%' }}>
        <Button
          onClick={onCreate}
          sx={{
            minHeight: 34,
            flex: 1,
            borderRadius: '10px',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            textTransform: 'none',
            fontSize: '0.84rem',
            backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 88%, transparent)',
          }}
        >
          Новая
        </Button>
        <Button
          onClick={onTemplate}
          sx={{
            minHeight: 34,
            flex: 1,
            borderRadius: '10px',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            textTransform: 'none',
            fontSize: '0.84rem',
            backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 88%, transparent)',
          }}
        >
          Из шаблона
        </Button>
      </Stack>
    </Box>
  )
}

function StandardCreateButtonsRow({ onCreate, onTemplate }: { onCreate: () => void; onTemplate: () => void }) {
  return (
    <Stack direction="row" spacing={0.7} sx={{ width: { xs: '100%', sm: 380 } }}>
      <Button
        onClick={onCreate}
        sx={{
          minHeight: 34,
          flex: 1,
          borderRadius: '10px',
          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
          textTransform: 'none',
          fontSize: '0.84rem',
          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 88%, transparent)',
        }}
      >
        Новая
      </Button>
      <Button
        onClick={onTemplate}
        sx={{
          minHeight: 34,
          flex: 1,
          borderRadius: '10px',
          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
          textTransform: 'none',
          fontSize: '0.84rem',
          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 88%, transparent)',
        }}
      >
        Из шаблона
      </Button>
    </Stack>
  )
}

function WorldCreatePage({ user, authToken, editingGameId = null, editSource = null, onNavigate }: WorldCreatePageProps) {
  const isEditMode = editingGameId !== null
  const isMyGamesEdit = isEditMode && editSource === 'my-games'
  const isMyPublicationsEdit = isEditMode && editSource === 'my-publications'
  const [isPageMenuOpen, setIsPageMenuOpen] = usePersistentPageMenuState()
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
  const [topUpDialogOpen, setTopUpDialogOpen] = useState(false)
  const [topUpPlans, setTopUpPlans] = useState<CoinTopUpPlan[]>([])
  const [hasTopUpPlansLoaded, setHasTopUpPlansLoaded] = useState(false)
  const [isTopUpPlansLoading, setIsTopUpPlansLoading] = useState(false)
  const [topUpError, setTopUpError] = useState('')
  const [activePlanPurchaseId, setActivePlanPurchaseId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(Boolean(isEditMode))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPublishWithoutMainHeroDialogOpen, setIsPublishWithoutMainHeroDialogOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [resolvedEditingGameId, setResolvedEditingGameId] = useState<number | null>(editingGameId)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [openingScene, setOpeningScene] = useState('')
  const [openingSceneNpcName, setOpeningSceneNpcName] = useState('')
  const [visibility, setVisibility] = useState<StoryGameVisibility>('private')
  const [ageRating, setAgeRating] = useState<StoryAgeRating>('16+')
  const [genres, setGenres] = useState<string[]>([])
  const [genreSearch, setGenreSearch] = useState('')
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null)
  const [coverScale, setCoverScale] = useState(1)
  const [coverPositionX, setCoverPositionX] = useState(50)
  const [coverPositionY, setCoverPositionY] = useState(50)
  const [coverCropSource, setCoverCropSource] = useState<string | null>(null)

  const [instructionCards, setInstructionCards] = useState<EditableCard[]>([])
  const [plotCards, setPlotCards] = useState<EditableCard[]>([])
  const [worldProfile, setWorldProfile] = useState<EditableWorldProfileCard | null>(null)
  const [mainHero, setMainHero] = useState<EditableCharacterCard | null>(null)
  const [npcs, setNpcs] = useState<EditableCharacterCard[]>([])
  const [characters, setCharacters] = useState<StoryCharacter[]>([])

  const [cardDialogOpen, setCardDialogOpen] = useState(false)
  const [cardDialogKind, setCardDialogKind] = useState<'instruction' | 'plot'>('instruction')
  const [cardDialogTargetLocalId, setCardDialogTargetLocalId] = useState<string | null>(null)
  const [cardTitleDraft, setCardTitleDraft] = useState('')
  const [cardContentDraft, setCardContentDraft] = useState('')
  const [cardTriggersDraft, setCardTriggersDraft] = useState('')
  const [cardIsEnabledDraft, setCardIsEnabledDraft] = useState(false)
  const [instructionTemplateDialogOpen, setInstructionTemplateDialogOpen] = useState(false)
  const [worldProfileDialogOpen, setWorldProfileDialogOpen] = useState(false)
  const [worldProfileDialogCardId, setWorldProfileDialogCardId] = useState<number | undefined>(undefined)
  const [worldProfileTitleDraft, setWorldProfileTitleDraft] = useState('')
  const [worldProfileContentDraft, setWorldProfileContentDraft] = useState('')
  const [worldProfileAvatarUrlDraft, setWorldProfileAvatarUrlDraft] = useState<string | null>(null)
  const [worldProfileAvatarOriginalUrlDraft, setWorldProfileAvatarOriginalUrlDraft] = useState<string | null>(null)
  const [worldProfileAvatarScaleDraft, setWorldProfileAvatarScaleDraft] = useState(1)
  const [worldProfileCropSource, setWorldProfileCropSource] = useState<string | null>(null)
  const [worldProfileTemplatePickerOpen, setWorldProfileTemplatePickerOpen] = useState(false)

  const [characterPickerTarget, setCharacterPickerTarget] = useState<'main_hero' | 'npc' | null>(null)
  const [characterPickerSourceTab, setCharacterPickerSourceTab] = useState<CharacterPickerSourceTab>('my')
  const [characterPickerSearchQuery, setCharacterPickerSearchQuery] = useState('')
  const [characterPickerAddedFilter, setCharacterPickerAddedFilter] = useState<CommunityAddedFilter>('all')
  const [characterPickerSortMode, setCharacterPickerSortMode] = useState<CommunitySortMode>('updated_desc')
  const [communityCharacterOptions, setCommunityCharacterOptions] = useState<StoryCommunityCharacterSummary[]>([])
  const [isLoadingCommunityCharacterOptions, setIsLoadingCommunityCharacterOptions] = useState(false)
  const [hasLoadedCommunityCharacterOptions, setHasLoadedCommunityCharacterOptions] = useState(false)
  const [expandedCommunityCharacterId, setExpandedCommunityCharacterId] = useState<number | null>(null)
  const [loadingCommunityCharacterId, setLoadingCommunityCharacterId] = useState<number | null>(null)
  const [savingCommunityCharacterId, setSavingCommunityCharacterId] = useState<number | null>(null)
  const [characterManagerOpen, setCharacterManagerOpen] = useState(false)
  const [characterManagerInitialMode, setCharacterManagerInitialMode] = useState<'list' | 'create'>('list')
  const [characterManagerInitialCharacterId, setCharacterManagerInitialCharacterId] = useState<number | null>(null)
  const [characterManagerReturnTarget, setCharacterManagerReturnTarget] = useState<'main_hero' | 'npc' | null>(null)
  const [characterManagerSyncTarget, setCharacterManagerSyncTarget] = useState<CharacterManagerSyncTarget | null>(null)
  const [isOpeningCharacterManager, setIsOpeningCharacterManager] = useState(false)

  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const worldProfileBannerInputRef = useRef<HTMLInputElement | null>(null)
  const openingSceneInputRef = useRef<HTMLTextAreaElement | null>(null)
  const loadedCommunityCharacterDetailsRef = useRef<Set<number>>(new Set())
  const publishWithoutMainHeroConfirmedRef = useRef(false)
  const sortedCharacters = useMemo(() => [...characters].sort((a, b) => a.name.localeCompare(b.name, 'ru-RU')), [characters])
  const selectedInstructionTemplateSignatures = useMemo(
    () => instructionCards.map((card) => createInstructionTemplateSignature(card.title, card.content)),
    [instructionCards],
  )
  const mainHeroCharacterId = useMemo(
    () => (typeof mainHero?.character_id === 'number' && mainHero.character_id > 0 ? mainHero.character_id : null),
    [mainHero?.character_id],
  )
  const mainHeroSourceCharacterId = useMemo(
    () =>
      typeof mainHero?.source_character_id === 'number' && mainHero.source_character_id > 0
        ? mainHero.source_character_id
        : null,
    [mainHero?.source_character_id],
  )
  const npcCharacterIds = useMemo(() => new Set(npcs.map((npc) => npc.character_id).filter((id): id is number => Boolean(id))), [npcs])
  const npcSourceCharacterIds = useMemo(() => {
    const ids = new Set<number>()
    npcs.forEach((npc) => {
      if (typeof npc.source_character_id === 'number' && npc.source_character_id > 0) {
        ids.add(npc.source_character_id)
      }
    })
    return ids
  }, [npcs])
  const canSubmit = useMemo(
    () => !isSubmitting && !isLoading && Boolean(title.trim()),
    [isLoading, isSubmitting, title],
  )
  const shouldConfirmPublishWithoutMainHero = useMemo(
    () => visibility === 'public' && !isMyGamesEdit && !isMyPublicationsEdit && Boolean(mainHero),
    [isMyGamesEdit, isMyPublicationsEdit, mainHero, visibility],
  )
  const visibleGenres = useMemo(() => {
    const query = genreSearch.trim().toLowerCase()
    if (!query) {
      return WORLD_GENRE_OPTIONS
    }
    return WORLD_GENRE_OPTIONS.filter((genre) => genre.toLowerCase().includes(query))
  }, [genreSearch])
  const filteredOwnCharacterOptions = useMemo(() => {
    const normalizedQuery = normalizeCharacterIdentity(characterPickerSearchQuery)
    if (!normalizedQuery) {
      return sortedCharacters
    }
    return sortedCharacters.filter((character) => {
      const searchValues = [
        character.name,
        character.description,
        character.race,
        character.clothing,
        character.inventory,
        character.health_status,
        character.note,
        ...character.triggers,
      ]
      return searchValues.some((value) => normalizeCharacterIdentity(value).includes(normalizedQuery))
    })
  }, [characterPickerSearchQuery, sortedCharacters])
  const filteredCommunityCharacterOptions = useMemo(() => {
    const normalizedQuery = normalizeCharacterIdentity(characterPickerSearchQuery)
    let nextItems = [...communityCharacterOptions]
    if (characterPickerAddedFilter === 'added') {
      nextItems = nextItems.filter((item) => item.is_added_by_user)
    } else if (characterPickerAddedFilter === 'not_added') {
      nextItems = nextItems.filter((item) => !item.is_added_by_user)
    }
    if (normalizedQuery) {
      nextItems = nextItems.filter((item) => {
        const searchValues = [
          item.name,
          item.description,
          item.race,
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
      if (characterPickerSortMode === 'rating_desc') {
        if (right.community_rating_avg !== left.community_rating_avg) {
          return right.community_rating_avg - left.community_rating_avg
        }
        return right.community_rating_count - left.community_rating_count
      }
      if (characterPickerSortMode === 'additions_desc') {
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
    characterPickerAddedFilter,
    characterPickerSearchQuery,
    characterPickerSortMode,
    communityCharacterOptions,
  ])

  const toggleGenre = useCallback((genre: string) => {
    setGenres((previous) => {
      if (previous.includes(genre)) {
        return previous.filter((item) => item !== genre)
      }
      if (previous.length >= MAX_WORLD_GENRES) {
        return previous
      }
      return [...previous, genre]
    })
  }, [])

  const persistTitleForGame = useCallback((gameId: number, nextTitle: string) => {
    const next = setStoryTitle(loadStoryTitleMap(), gameId, nextTitle)
    persistStoryTitleMap(next)
  }, [])

  const getTemplateDisabledReason = useCallback(
    (character: StoryCharacter, target: 'main_hero' | 'npc'): string | null => {
      if (target === 'main_hero') {
        return npcCharacterIds.has(character.id) ? 'Уже выбран как NPC' : null
      }
      if (mainHeroCharacterId === character.id) {
        return 'Уже выбран как главный герой'
      }
      return npcCharacterIds.has(character.id) ? 'Уже выбран как NPC' : null
    },
    [mainHeroCharacterId, npcCharacterIds],
  )
  const getCommunityTemplateDisabledReason = useCallback(
    (character: StoryCommunityCharacterSummary, target: 'main_hero' | 'npc'): string | null => {
      if (target === 'main_hero') {
        return npcSourceCharacterIds.has(character.id) ? 'Уже выбран как NPC' : null
      }
      if (mainHeroSourceCharacterId === character.id) {
        return 'Уже выбран как главный герой'
      }
      return npcSourceCharacterIds.has(character.id) ? 'Уже выбран как NPC' : null
    },
    [mainHeroSourceCharacterId, npcSourceCharacterIds],
  )

  const hasTemplateConflicts = useCallback((hero: EditableCharacterCard | null, nextNpcs: EditableCharacterCard[]) => {
    const usedNpcTemplates = new Set<number>()
    const usedNpcSources = new Set<number>()
    for (const npc of nextNpcs) {
      if (!npc.character_id) continue
      if (hero?.character_id && npc.character_id === hero.character_id) return true
      if (usedNpcTemplates.has(npc.character_id)) return true
      usedNpcTemplates.add(npc.character_id)
    }
    for (const npc of nextNpcs) {
      if (!npc.source_character_id) continue
      if (hero?.source_character_id && npc.source_character_id === hero.source_character_id) return true
      if (usedNpcSources.has(npc.source_character_id)) return true
      usedNpcSources.add(npc.source_character_id)
    }
    return false
  }, [])
  const loadCommunityCharacterOptions = useCallback(async () => {
    setIsLoadingCommunityCharacterOptions(true)
    setErrorMessage('')
    try {
      const items = await listCommunityCharacters(authToken)
      setCommunityCharacterOptions(items.map((item) => ({ ...item, note: normalizeCharacterNote(item.note ?? '') })))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to open character editor'
      setErrorMessage(detail)
    } finally {
      setIsLoadingCommunityCharacterOptions(false)
      setHasLoadedCommunityCharacterOptions(true)
    }
  }, [authToken])

  const loadCharacters = useCallback(async (): Promise<StoryCharacter[]> => {
    try {
      const items = await listStoryCharacters(authToken)
      const normalizedItems = items.map((item) => ({
        ...item,
        note: normalizeCharacterNote(item.note ?? ''),
      }))
      const filteredItems = normalizedItems.filter((character) => {
        if (character.visibility !== 'public' || character.source_character_id === null) {
          return true
        }
        const sourceCharacter = normalizedItems.find((candidate) => candidate.id === character.source_character_id)
        return !sourceCharacter || sourceCharacter.user_id !== character.user_id
      })
      setCharacters(filteredItems)
      return filteredItems
    } catch {
      setCharacters([])
      return []
    }
  }, [authToken])

  useEffect(() => {
    void loadCharacters()
  }, [loadCharacters])

  useEffect(() => {
    if (characters.length === 0) {
      return
    }
    const charactersById = new Map<number, StoryCharacter>()
    characters.forEach((character) => {
      charactersById.set(character.id, character)
    })

    setMainHero((previous) => {
      if (!previous?.character_id) {
        return previous
      }
      const linkedCharacter = charactersById.get(previous.character_id)
      if (!linkedCharacter) {
        return previous
      }
      const nextNote = normalizeCharacterNote(linkedCharacter.note ?? '')
      const nextSourceCharacterId = linkedCharacter.source_character_id ?? null
      const nextRace = normalizeCharacterRace(linkedCharacter.race)
      const nextClothing = normalizeCharacterAdditionalField(linkedCharacter.clothing)
      const nextInventory = normalizeCharacterAdditionalField(linkedCharacter.inventory)
      const nextHealthStatus = normalizeCharacterAdditionalField(linkedCharacter.health_status)
      const nextAvatarUrl = linkedCharacter.avatar_url ?? previous.avatar_url
      const nextAvatarOriginalUrl = linkedCharacter.avatar_original_url ?? linkedCharacter.avatar_url ?? previous.avatar_original_url
      if (
        previous.note === nextNote &&
        previous.source_character_id === nextSourceCharacterId &&
        previous.race === nextRace &&
        previous.clothing === nextClothing &&
        previous.inventory === nextInventory &&
        previous.health_status === nextHealthStatus &&
        previous.avatar_url === nextAvatarUrl &&
        previous.avatar_original_url === nextAvatarOriginalUrl
      ) {
        return previous
      }
      return {
        ...previous,
        race: nextRace,
        clothing: nextClothing,
        inventory: nextInventory,
        health_status: nextHealthStatus,
        note: nextNote,
        source_character_id: nextSourceCharacterId,
        avatar_url: nextAvatarUrl,
        avatar_original_url: nextAvatarOriginalUrl,
      }
    })

    setNpcs((previous) => {
      let hasChanges = false
      const next = previous.map((npc) => {
        if (!npc.character_id) {
          return npc
        }
        const linkedCharacter = charactersById.get(npc.character_id)
        if (!linkedCharacter) {
          return npc
        }
        const nextNote = normalizeCharacterNote(linkedCharacter.note ?? '')
        const nextSourceCharacterId = linkedCharacter.source_character_id ?? null
        const nextRace = normalizeCharacterRace(linkedCharacter.race)
        const nextClothing = normalizeCharacterAdditionalField(linkedCharacter.clothing)
        const nextInventory = normalizeCharacterAdditionalField(linkedCharacter.inventory)
        const nextHealthStatus = normalizeCharacterAdditionalField(linkedCharacter.health_status)
        const nextAvatarUrl = linkedCharacter.avatar_url ?? npc.avatar_url
        const nextAvatarOriginalUrl = linkedCharacter.avatar_original_url ?? linkedCharacter.avatar_url ?? npc.avatar_original_url
        if (
          npc.note === nextNote &&
          npc.source_character_id === nextSourceCharacterId &&
          npc.race === nextRace &&
          npc.clothing === nextClothing &&
          npc.inventory === nextInventory &&
          npc.health_status === nextHealthStatus &&
          npc.avatar_url === nextAvatarUrl &&
          npc.avatar_original_url === nextAvatarOriginalUrl
        ) {
          return npc
        }
        hasChanges = true
        return {
          ...npc,
          race: nextRace,
          clothing: nextClothing,
          inventory: nextInventory,
          health_status: nextHealthStatus,
          note: nextNote,
          source_character_id: nextSourceCharacterId,
          avatar_url: nextAvatarUrl,
          avatar_original_url: nextAvatarOriginalUrl,
        }
      })
      return hasChanges ? next : previous
    })
  }, [characters])

  useEffect(() => {
    if (!characterPickerTarget) {
      setCharacterPickerSourceTab('my')
      setCharacterPickerSearchQuery('')
      setCharacterPickerAddedFilter('all')
      setCharacterPickerSortMode('updated_desc')
      setExpandedCommunityCharacterId(null)
      setLoadingCommunityCharacterId(null)
      setSavingCommunityCharacterId(null)
      setHasLoadedCommunityCharacterOptions(false)
      loadedCommunityCharacterDetailsRef.current.clear()
      return
    }
    setCharacterPickerSourceTab('my')
    setCharacterPickerSearchQuery('')
    setCharacterPickerAddedFilter('all')
    setCharacterPickerSortMode('updated_desc')
    setExpandedCommunityCharacterId(null)
    setLoadingCommunityCharacterId(null)
    setSavingCommunityCharacterId(null)
  }, [characterPickerTarget])

  useEffect(() => {
    if (
      !characterPickerTarget ||
      characterPickerSourceTab !== 'community' ||
      hasLoadedCommunityCharacterOptions ||
      isLoadingCommunityCharacterOptions
    ) {
      return
    }
    void loadCommunityCharacterOptions()
  }, [
    characterPickerSourceTab,
    characterPickerTarget,
    hasLoadedCommunityCharacterOptions,
    isLoadingCommunityCharacterOptions,
    loadCommunityCharacterOptions,
  ])

  useEffect(() => {
    if (!isEditMode || editingGameId === null) {
      setResolvedEditingGameId(editingGameId)
      setIsLoading(false)
      return
    }
    let active = true
    setIsLoading(true)
    setResolvedEditingGameId(editingGameId)
    const loadEditingPayload = async () => {
      const initialPayload = await getStoryGame({ token: authToken, gameId: editingGameId })
      if (!isMyPublicationsEdit) {
        return initialPayload
      }
      const sourceWorldId = initialPayload.game.source_world_id
      if (
        typeof sourceWorldId === 'number' &&
        sourceWorldId > 0 &&
        sourceWorldId !== initialPayload.game.id
      ) {
        return getStoryGame({ token: authToken, gameId: sourceWorldId })
      }
      return initialPayload
    }
    void loadEditingPayload()
      .then((payload) => {
        if (!active) return
        setResolvedEditingGameId(payload.game.id)
        setTitle(payload.game.title)
        setDescription(payload.game.description)
        setOpeningScene(payload.game.opening_scene ?? '')
        setVisibility(resolvePublicationDraftVisibility(payload.game.publication, payload.game.visibility))
        setAgeRating(payload.game.age_rating)
        setGenres(payload.game.genres.slice(0, MAX_WORLD_GENRES))
        setCoverImageUrl(payload.game.cover_image_url)
        setCoverScale(payload.game.cover_scale ?? 1)
        setCoverPositionX(payload.game.cover_position_x ?? 50)
        setCoverPositionY(payload.game.cover_position_y ?? 50)
        setInstructionCards(payload.instruction_cards.map((card) => ({ localId: makeLocalId(), id: card.id, title: card.title, content: card.content })))
        setPlotCards(
          payload.plot_cards.map((card) => ({
            localId: makeLocalId(),
            id: card.id,
            title: card.title,
            content: card.content,
            triggers: card.triggers.join(', '),
            is_enabled: Boolean(card.is_enabled),
          })),
        )
        const worldProfileCard = payload.world_cards.find((card) => card.kind === 'world_profile') ?? null
        setWorldProfile(worldProfileCard ? toEditableWorldProfileFromWorldCard(worldProfileCard) : null)
        const hero = payload.world_cards.find((card) => card.kind === 'main_hero') ?? null
        setMainHero(isMyPublicationsEdit ? null : hero ? toEditableCharacterFromWorldCard(hero) : null)
        setNpcs(payload.world_cards.filter((card) => card.kind === 'npc').map(toEditableCharacterFromWorldCard))
      })
      .catch((error) => active && setErrorMessage(error instanceof Error ? error.message : 'Не удалось загрузить мир'))
      .finally(() => active && setIsLoading(false))
    return () => { active = false }
  }, [authToken, editingGameId, isEditMode, isMyPublicationsEdit])

  const handleCoverUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }
    try {
      const dataUrl = await compressImageFileToDataUrl(file, { maxBytes: COVER_MAX_BYTES, maxDimension: 1800 })
      setCoverCropSource(dataUrl)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось загрузить обложку')
    }
  }, [])

  const openCoverCropEditor = useCallback(() => {
    if (!coverImageUrl) {
      return
    }
    setCoverCropSource(coverImageUrl)
  }, [coverImageUrl])

  const handleCancelCoverCrop = useCallback(() => {
    setCoverCropSource(null)
  }, [])

  const handleSaveCoverCrop = useCallback(async (croppedDataUrl: string) => {
    try {
      const preparedCover = await compressImageDataUrl(croppedDataUrl, {
        maxBytes: getJsonDataUrlRequestSafeMaxBytes(COVER_MAX_BYTES),
        maxDimension: 1800,
      })
      setCoverImageUrl(preparedCover)
      setCoverScale(1)
      setCoverPositionX(50)
      setCoverPositionY(50)
      setCoverCropSource(null)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось подготовить обложку')
    }
  }, [])

  const openWorldProfileDialog = useCallback((card?: EditableWorldProfileCard | null) => {
    setWorldProfileDialogCardId(card?.id)
    setWorldProfileTitleDraft(card?.title ?? '')
    setWorldProfileContentDraft(card?.content ?? '')
    setWorldProfileAvatarUrlDraft(card?.avatar_url ?? null)
    setWorldProfileAvatarOriginalUrlDraft(card?.avatar_original_url ?? card?.avatar_url ?? null)
    setWorldProfileAvatarScaleDraft(card?.avatar_scale ?? 1)
    setWorldProfileCropSource(null)
    setWorldProfileDialogOpen(true)
  }, [])

  const closeWorldProfileDialog = useCallback(() => {
    setWorldProfileDialogOpen(false)
    setWorldProfileCropSource(null)
  }, [])

  const handleWorldProfileBannerUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Выберите изображение для баннера мира.')
      return
    }
    try {
      const dataUrl = await compressImageFileToDataUrl(file, {
        maxBytes: WORLD_PROFILE_BANNER_MAX_BYTES,
        maxDimension: 1800,
      })
      setWorldProfileCropSource(dataUrl)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось загрузить баннер мира')
    }
  }, [])

  const openWorldProfileCropEditor = useCallback(() => {
    const cropSource = worldProfileAvatarOriginalUrlDraft ?? worldProfileAvatarUrlDraft
    if (!cropSource) {
      worldProfileBannerInputRef.current?.click()
      return
    }
    setWorldProfileCropSource(cropSource)
  }, [worldProfileAvatarOriginalUrlDraft, worldProfileAvatarUrlDraft])

  const handleCancelWorldProfileCrop = useCallback(() => {
    setWorldProfileCropSource(null)
  }, [])

  const handleSaveWorldProfileCrop = useCallback(async (croppedDataUrl: string) => {
    try {
      const preparedBanner = await compressImageDataUrl(croppedDataUrl, {
        maxBytes: getJsonDataUrlRequestSafeMaxBytes(WORLD_PROFILE_BANNER_MAX_BYTES),
        maxDimension: 1800,
      })
      setWorldProfileAvatarUrlDraft(preparedBanner)
      setWorldProfileAvatarOriginalUrlDraft(preparedBanner)
      setWorldProfileAvatarScaleDraft(1)
      setWorldProfileCropSource(null)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось подготовить баннер мира')
    }
  }, [])

  const saveWorldProfileDialog = useCallback(() => {
    const normalizedTitle = worldProfileTitleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = worldProfileContentDraft.replace(/\r\n/g, '\n').trim()
    if (!normalizedTitle || !normalizedContent) {
      return
    }
    setWorldProfile({
      id: worldProfileDialogCardId,
      title: normalizedTitle,
      content: normalizedContent,
      avatar_url: worldProfileAvatarUrlDraft,
      avatar_original_url: worldProfileAvatarOriginalUrlDraft ?? worldProfileAvatarUrlDraft,
      avatar_scale: clamp(worldProfileAvatarScaleDraft ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
    })
    setWorldProfileDialogOpen(false)
    setWorldProfileCropSource(null)
    setErrorMessage('')
  }, [
    worldProfileAvatarOriginalUrlDraft,
    worldProfileAvatarScaleDraft,
    worldProfileAvatarUrlDraft,
    worldProfileContentDraft,
    worldProfileDialogCardId,
    worldProfileTitleDraft,
  ])

  const handleApplyWorldProfileTemplate = useCallback((template: StoryWorldCardTemplate) => {
    setWorldProfile((previous) => toEditableWorldProfileFromTemplate(template, previous?.id))
    setWorldProfileTemplatePickerOpen(false)
    setErrorMessage('')
  }, [])

  const openCardDialog = useCallback((kind: 'instruction' | 'plot', card?: EditableCard) => {
    setCardDialogKind(kind)
    setCardDialogTargetLocalId(card?.localId ?? null)
    setCardTitleDraft(card?.title ?? '')
    setCardContentDraft(card?.content ?? '')
    setCardTriggersDraft(kind === 'plot' ? card?.triggers ?? '' : '')
    setCardIsEnabledDraft(kind === 'plot' ? Boolean(card?.is_enabled) : false)
    setCardDialogOpen(true)
  }, [])

  const saveCardDialog = useCallback(() => {
    const baseNext: EditableCard = {
      localId: cardDialogTargetLocalId ?? makeLocalId(),
      title: cardTitleDraft.trim(),
      content: cardContentDraft.trim(),
    }
    const next: EditableCard =
      cardDialogKind === 'plot'
        ? { ...baseNext, triggers: cardTriggersDraft, is_enabled: cardIsEnabledDraft }
        : baseNext
    if (!next.title || !next.content) return
    const setter = cardDialogKind === 'instruction' ? setInstructionCards : setPlotCards
    setter((prev) => {
      const idx = prev.findIndex((item) => item.localId === next.localId)
      if (idx < 0) return [...prev, next]
      const copy = [...prev]
      copy[idx] = { ...copy[idx], ...next }
      return copy
    })
    setCardDialogOpen(false)
  }, [cardContentDraft, cardDialogKind, cardDialogTargetLocalId, cardIsEnabledDraft, cardTitleDraft, cardTriggersDraft])

  const handleApplyInstructionTemplate = useCallback(async (template: { title: string; content: string }) => {
    const normalizedTitle = template.title.replace(/\s+/g, ' ').trim()
    const normalizedContent = template.content.replace(/\r\n/g, '\n').trim()
    if (!normalizedTitle || !normalizedContent) {
      setErrorMessage('Шаблон инструкции пустой')
      return
    }
    const templateSignature = createInstructionTemplateSignature(normalizedTitle, normalizedContent)
    const alreadyAdded = instructionCards.some(
      (card) => createInstructionTemplateSignature(card.title, card.content) === templateSignature,
    )
    if (alreadyAdded) {
      const detail = 'Этот шаблон уже добавлен в карточки инструкций.'
      setErrorMessage(detail)
      throw new Error(detail)
    }
    setInstructionCards((previous) => [...previous, { localId: makeLocalId(), title: normalizedTitle, content: normalizedContent }])
  }, [instructionCards])

  const openCharacterManagerForCreate = useCallback((target: 'main_hero' | 'npc') => {
    setCharacterManagerInitialMode('create')
    setCharacterManagerInitialCharacterId(null)
    setCharacterManagerSyncTarget(null)
    setCharacterManagerReturnTarget(target)
    setCharacterManagerOpen(true)
  }, [])

  const openCharacterManagerForEdit = useCallback(
    async (target: 'main_hero' | 'npc', card: EditableCharacterCard) => {
      setIsOpeningCharacterManager(true)
      setErrorMessage('')
      try {
        let targetCharacterId = card.character_id
        if (!targetCharacterId) {
          const normalizedName = card.name.replace(/\s+/g, ' ').trim() || (target === 'main_hero' ? 'Main hero' : 'NPC')
          const normalizedDescription = card.description.replace(/\r\n/g, '\n').trim() || 'World card character'
          const preparedMirroredAvatarUrl = await prepareAvatarUrlForRequest(card.avatar_url, {
            maxBytes: CHARACTER_AVATAR_MAX_BYTES,
            maxDimension: 1200,
          })
          const preparedMirroredAvatarOriginalUrl = await prepareAvatarUrlForRequest(card.avatar_original_url ?? card.avatar_url, {
            maxBytes: CHARACTER_AVATAR_MAX_BYTES,
            maxDimension: 1200,
          })
          const mirroredCharacter = await createStoryCharacter({
            token: authToken,
            input: {
              name: normalizedName,
              description: normalizedDescription,
              race: normalizeCharacterRace(card.race),
              clothing: normalizeCharacterAdditionalField(card.clothing),
              inventory: normalizeCharacterAdditionalField(card.inventory),
              health_status: normalizeCharacterAdditionalField(card.health_status),
              note: normalizeCharacterNote(card.note),
              triggers: parseTriggers(card.triggers, normalizedName),
              avatar_url: preparedMirroredAvatarUrl,
              avatar_original_url: preparedMirroredAvatarOriginalUrl,
              avatar_scale: clamp(card.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
              emotion_assets: card.emotion_assets ?? {},
              emotion_model: card.emotion_model ?? null,
              emotion_prompt_lock: card.emotion_prompt_lock ?? null,
              visibility: 'private',
            },
          })
          targetCharacterId = mirroredCharacter.id
          setCharacters((previous) => [...previous.filter((item) => item.id !== mirroredCharacter.id), mirroredCharacter])
          if (target === 'main_hero') {
            setMainHero((previous) =>
              previous && previous.localId === card.localId
                ? {
                    ...previous,
                    character_id: mirroredCharacter.id,
                    source_character_id: mirroredCharacter.source_character_id ?? null,
                    race: normalizeCharacterRace(mirroredCharacter.race),
                    clothing: normalizeCharacterAdditionalField(mirroredCharacter.clothing),
                    inventory: normalizeCharacterAdditionalField(mirroredCharacter.inventory),
                    health_status: normalizeCharacterAdditionalField(mirroredCharacter.health_status),
                    note: normalizeCharacterNote(mirroredCharacter.note),
                    avatar_url: mirroredCharacter.avatar_url ?? previous.avatar_url,
                    avatar_original_url: mirroredCharacter.avatar_original_url ?? previous.avatar_original_url ?? previous.avatar_url,
                    emotion_assets: mirroredCharacter.emotion_assets ?? {},
                    emotion_model: mirroredCharacter.emotion_model ?? '',
                    emotion_prompt_lock: mirroredCharacter.emotion_prompt_lock ?? null,
                  }
                : previous,
            )
          } else {
            setNpcs((previous) =>
              previous.map((item) =>
                item.localId === card.localId
                  ? {
                      ...item,
                      character_id: mirroredCharacter.id,
                      source_character_id: mirroredCharacter.source_character_id ?? null,
                      race: normalizeCharacterRace(mirroredCharacter.race),
                      clothing: normalizeCharacterAdditionalField(mirroredCharacter.clothing),
                      inventory: normalizeCharacterAdditionalField(mirroredCharacter.inventory),
                      health_status: normalizeCharacterAdditionalField(mirroredCharacter.health_status),
                      note: normalizeCharacterNote(mirroredCharacter.note),
                      avatar_url: mirroredCharacter.avatar_url ?? item.avatar_url,
                      avatar_original_url: mirroredCharacter.avatar_original_url ?? item.avatar_original_url ?? item.avatar_url,
                      emotion_assets: mirroredCharacter.emotion_assets ?? {},
                      emotion_model: mirroredCharacter.emotion_model ?? '',
                      emotion_prompt_lock: mirroredCharacter.emotion_prompt_lock ?? null,
                    }
                  : item,
              ),
            )
          }
        }
        setCharacterManagerInitialMode('list')
        setCharacterManagerInitialCharacterId(targetCharacterId)
        setCharacterManagerSyncTarget({ target, localId: card.localId })
        setCharacterManagerReturnTarget(null)
        setCharacterManagerOpen(true)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Failed to open character editor'
        setErrorMessage(detail)
      } finally {
        setIsOpeningCharacterManager(false)
      }
    },
    [authToken],
  )

  const handleCloseCharacterManager = useCallback(() => {
    const targetCharacterId = characterManagerInitialCharacterId
    const syncTarget = characterManagerSyncTarget
    const returnTarget = characterManagerReturnTarget
    setCharacterManagerOpen(false)
    setCharacterManagerInitialMode('list')
    setCharacterManagerInitialCharacterId(null)
    setCharacterManagerSyncTarget(null)
    setCharacterManagerReturnTarget(null)
    void (async () => {
      const latestCharacters = await loadCharacters()
      if (syncTarget && targetCharacterId) {
        const linkedCharacter = latestCharacters.find((item) => item.id === targetCharacterId) ?? null
        if (linkedCharacter) {
          const nextTriggers = linkedCharacter.triggers.join(', ')
          const nextAvatarScale = clamp(linkedCharacter.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX)
          if (syncTarget.target === 'main_hero') {
            setMainHero((previous) => {
              if (!previous || previous.localId !== syncTarget.localId) {
                return previous
              }
              return {
                ...previous,
                character_id: linkedCharacter.id,
                source_character_id: linkedCharacter.source_character_id ?? null,
                name: linkedCharacter.name,
                description: linkedCharacter.description,
                race: normalizeCharacterRace(linkedCharacter.race),
                clothing: normalizeCharacterAdditionalField(linkedCharacter.clothing),
                inventory: normalizeCharacterAdditionalField(linkedCharacter.inventory),
                health_status: normalizeCharacterAdditionalField(linkedCharacter.health_status),
                note: normalizeCharacterNote(linkedCharacter.note),
                triggers: nextTriggers,
                avatar_url: linkedCharacter.avatar_url,
                avatar_original_url: linkedCharacter.avatar_original_url ?? linkedCharacter.avatar_url,
                avatar_scale: nextAvatarScale,
                emotion_assets: linkedCharacter.emotion_assets ?? {},
                emotion_model: linkedCharacter.emotion_model ?? '',
                emotion_prompt_lock: linkedCharacter.emotion_prompt_lock ?? null,
              }
            })
          } else {
            setNpcs((previous) =>
              previous.map((item) =>
                item.localId === syncTarget.localId
                  ? {
                      ...item,
                      character_id: linkedCharacter.id,
                      source_character_id: linkedCharacter.source_character_id ?? null,
                      name: linkedCharacter.name,
                      description: linkedCharacter.description,
                      race: normalizeCharacterRace(linkedCharacter.race),
                      clothing: normalizeCharacterAdditionalField(linkedCharacter.clothing),
                      inventory: normalizeCharacterAdditionalField(linkedCharacter.inventory),
                      health_status: normalizeCharacterAdditionalField(linkedCharacter.health_status),
                      note: normalizeCharacterNote(linkedCharacter.note),
                      triggers: nextTriggers,
                      avatar_url: linkedCharacter.avatar_url,
                      avatar_original_url: linkedCharacter.avatar_original_url ?? linkedCharacter.avatar_url,
                      avatar_scale: nextAvatarScale,
                      emotion_assets: linkedCharacter.emotion_assets ?? {},
                      emotion_model: linkedCharacter.emotion_model ?? '',
                      emotion_prompt_lock: linkedCharacter.emotion_prompt_lock ?? null,
                    }
                  : item,
              ),
            )
          }
        }
      }
      if (returnTarget) {
        setCharacterPickerTarget(returnTarget)
      }
    })()
  }, [
    characterManagerInitialCharacterId,
    characterManagerReturnTarget,
    characterManagerSyncTarget,
    loadCharacters,
  ])

  const applyTemplate = useCallback((character: StoryCharacter) => {
    if (!characterPickerTarget) return
    const reason = getTemplateDisabledReason(character, characterPickerTarget)
    if (reason) {
      setErrorMessage(reason)
      return
    }
    const card = toEditableCharacterFromTemplate(character)
    if (characterPickerTarget === 'main_hero') {
      setMainHero((prev) => (prev ? { ...card, id: prev.id } : card))
    } else {
      setNpcs((prev) => [...prev, card])
    }
    setCharacterPickerTarget(null)
  }, [characterPickerTarget, getTemplateDisabledReason])

  const handleToggleCommunityCharacterCard = useCallback(
    async (characterId: number) => {
      if (expandedCommunityCharacterId === characterId) {
        setExpandedCommunityCharacterId(null)
        return
      }
      setExpandedCommunityCharacterId(characterId)
      if (loadedCommunityCharacterDetailsRef.current.has(characterId)) {
        return
      }
      setLoadingCommunityCharacterId(characterId)
      try {
        const detailedCharacter = await getCommunityCharacter({
          token: authToken,
          characterId,
        })
        setCommunityCharacterOptions((previous) =>
          previous.map((item) =>
            item.id === detailedCharacter.id ? { ...detailedCharacter, note: normalizeCharacterNote(detailedCharacter.note ?? '') } : item,
          ),
        )
        loadedCommunityCharacterDetailsRef.current.add(characterId)
      } catch {
        // Keep summary card expanded even if details fetch fails.
      } finally {
        setLoadingCommunityCharacterId((previous) => (previous === characterId ? null : previous))
      }
    },
    [authToken, expandedCommunityCharacterId],
  )

  const handleApplyCommunityTemplate = useCallback(
    async (character: StoryCommunityCharacterSummary, options: { saveToProfile: boolean }) => {
      if (!characterPickerTarget || savingCommunityCharacterId !== null) {
        return
      }
      const reason = getCommunityTemplateDisabledReason(character, characterPickerTarget)
      if (reason) {
        setErrorMessage(reason)
        return
      }
      setErrorMessage('')
      setSavingCommunityCharacterId(character.id)
      try {
        let profileCharacterId: number | null = null
        if (options.saveToProfile) {
          let availableCharacters = characters
          if (!character.is_added_by_user) {
            await addCommunityCharacter({
              token: authToken,
              characterId: character.id,
            })
            const refreshedCharacters = await listStoryCharacters(authToken)
            const normalizedCharacters = refreshedCharacters.map((item) => ({
              ...item,
              note: normalizeCharacterNote(item.note ?? ''),
            }))
            setCharacters(normalizedCharacters)
            availableCharacters = normalizedCharacters
          }
          const linkedCharacter = availableCharacters.find((item) => item.source_character_id === character.id) ?? null
          profileCharacterId = linkedCharacter?.id ?? null
          if (!character.is_added_by_user) {
            setCommunityCharacterOptions((previous) =>
              previous.map((item) =>
                item.id === character.id ? { ...item, is_added_by_user: true } : item,
              ),
            )
          }
        }

        const card = toEditableCharacterFromCommunity(character, profileCharacterId)
        if (characterPickerTarget === 'main_hero') {
          setMainHero((previous) => (previous ? { ...card, id: previous.id } : card))
        } else {
          setNpcs((previous) => [...previous, card])
        }
        setCharacterPickerTarget(null)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Failed to open character editor'
        setErrorMessage(detail)
      } finally {
        setSavingCommunityCharacterId((previous) => (previous === character.id ? null : previous))
      }
    },
    [authToken, characterPickerTarget, characters, getCommunityTemplateDisabledReason, savingCommunityCharacterId],
  )

  const buildOpeningSceneTag = useCallback(
    (kind: 'gg_name' | 'gg_speech' | 'gg_thought' | 'npc_speech' | 'npc_thought'): string => {
      const normalizedNpcName =
        openingSceneNpcName.replace(/\r\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, OPENING_SCENE_NPC_NAME_MAX_LENGTH) ||
        OPENING_SCENE_NPC_FALLBACK_NAME
      if (kind === 'gg_name') {
        return `[[GG:${OPENING_SCENE_GG_FALLBACK_NAME}]] `
      }
      if (kind === 'gg_speech') {
        return `[[GG_REPLICK:${OPENING_SCENE_GG_FALLBACK_NAME}]] `
      }
      if (kind === 'gg_thought') {
        return `[[GG_THOUGHT:${OPENING_SCENE_GG_FALLBACK_NAME}]] `
      }
      if (kind === 'npc_speech') {
        return `[[NPC:${normalizedNpcName}]] `
      }
      return `[[NPC_THOUGHT:${normalizedNpcName}]] `
    },
    [openingSceneNpcName],
  )

  const insertOpeningSceneTag = useCallback(
    (kind: 'gg_name' | 'gg_speech' | 'gg_thought' | 'npc_speech' | 'npc_thought') => {
      const tag = buildOpeningSceneTag(kind)
      const textarea = openingSceneInputRef.current

      if (!textarea) {
        setOpeningScene((previous) => {
          const trimmed = previous.replace(/\s+$/g, '')
          return trimmed.length > 0 ? `${trimmed}\n${tag}` : tag
        })
        return
      }

      setOpeningScene((previous) => {
        const selectionStart = textarea.selectionStart ?? previous.length
        const selectionEnd = textarea.selectionEnd ?? selectionStart
        const before = previous.slice(0, selectionStart)
        const after = previous.slice(selectionEnd)
        const shouldAddLeadingBreak = before.length > 0 && !before.endsWith('\n')
        const shouldAddTrailingBreak = after.length > 0 && !after.startsWith('\n')
        const insertedTag = `${shouldAddLeadingBreak ? '\n' : ''}${tag}${shouldAddTrailingBreak ? '\n' : ''}`
        const nextValue = `${before}${insertedTag}${after}`
        const cursorPosition = before.length + insertedTag.length
        window.setTimeout(() => {
          textarea.focus()
          textarea.setSelectionRange(cursorPosition, cursorPosition)
        }, 0)
        return nextValue
      })
    },
    [buildOpeningSceneTag],
  )

  const handleSaveWorld = useCallback(async () => {
    if (!canSubmit) return
    if (shouldConfirmPublishWithoutMainHero && !publishWithoutMainHeroConfirmedRef.current) {
      setIsPublishWithoutMainHeroDialogOpen(true)
      return
    }
    publishWithoutMainHeroConfirmedRef.current = false
    if (!isMyGamesEdit && hasTemplateConflicts(mainHero, npcs)) {
      setErrorMessage('Удалите дубли персонажей: ГГ и NPC не могут ссылаться на одного персонажа, а NPC не должны повторяться.')
      return
    }
    setIsSubmitting(true)
    setIsPublishWithoutMainHeroDialogOpen(false)
    setErrorMessage('')
    try {
      let gameId = resolvedEditingGameId
      const normalizedTitle = title.trim()
      const normalizedDescription = description.trim()
      const normalizedOpeningScene = openingScene.replace(/\r\n/g, '\n').trim()
      const preparedCoverImageUrl = coverImageUrl?.startsWith('data:image/')
        ? await compressImageDataUrl(coverImageUrl, {
            maxBytes: getJsonDataUrlRequestSafeMaxBytes(COVER_MAX_BYTES),
            maxDimension: 1800,
          })
        : coverImageUrl
      const prepareAvatarForRequest = async (avatarUrl: string | null): Promise<string | null> => {
        return prepareAvatarUrlForRequest(avatarUrl, {
          maxBytes: CHARACTER_AVATAR_MAX_BYTES,
          maxDimension: 1200,
        })
      }
      const prepareWorldBannerForRequest = async (avatarUrl: string | null): Promise<string | null> => {
        return prepareAvatarUrlForRequest(avatarUrl, {
          maxBytes: WORLD_PROFILE_BANNER_MAX_BYTES,
          maxDimension: 1800,
        })
      }
      const ensureLinkedCharacter = async (card: EditableCharacterCard | null): Promise<EditableCharacterCard | null> => {
        if (!card || (typeof card.character_id === 'number' && card.character_id > 0)) {
          return card
        }
        const hasEmotionPack = Object.values(card.emotion_assets ?? {}).some(
          (value) => typeof value === 'string' && value.trim().length > 0,
        )
        if (!hasEmotionPack) {
          return card
        }

        const normalizedCharacterName = card.name.replace(/\s+/g, ' ').trim() || 'Персонаж'
        const normalizedCharacterDescription = card.description.replace(/\r\n/g, '\n').trim() || 'Описание персонажа'
        const preparedCharacterAvatarUrl = await prepareAvatarForRequest(card.avatar_url)
        const preparedCharacterAvatarOriginalUrl = await prepareAvatarForRequest(card.avatar_original_url ?? card.avatar_url)
        const createdCharacter = await createStoryCharacter({
          token: authToken,
          input: {
            name: normalizedCharacterName,
            description: normalizedCharacterDescription,
            race: normalizeCharacterRace(card.race),
            clothing: normalizeCharacterAdditionalField(card.clothing),
            inventory: normalizeCharacterAdditionalField(card.inventory),
            health_status: normalizeCharacterAdditionalField(card.health_status),
            note: normalizeCharacterNote(card.note),
            triggers: parseTriggers(card.triggers, normalizedCharacterName),
            avatar_url: preparedCharacterAvatarUrl,
            avatar_original_url: preparedCharacterAvatarOriginalUrl,
            avatar_scale: clamp(card.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
            emotion_assets: card.emotion_assets ?? {},
            emotion_model: card.emotion_model ?? null,
            emotion_prompt_lock: card.emotion_prompt_lock ?? null,
            visibility: 'private',
          },
        })
        setCharacters((previous) => [...previous.filter((item) => item.id !== createdCharacter.id), createdCharacter])
        return {
          ...card,
          character_id: createdCharacter.id,
          source_character_id: createdCharacter.source_character_id ?? card.source_character_id,
          race: normalizeCharacterRace(createdCharacter.race || card.race),
          clothing: normalizeCharacterAdditionalField(createdCharacter.clothing || card.clothing),
          inventory: normalizeCharacterAdditionalField(createdCharacter.inventory || card.inventory),
          health_status: normalizeCharacterAdditionalField(createdCharacter.health_status || card.health_status),
          avatar_url: createdCharacter.avatar_url ?? card.avatar_url,
          avatar_original_url: createdCharacter.avatar_original_url ?? card.avatar_original_url ?? card.avatar_url,
          avatar_scale: clamp(createdCharacter.avatar_scale ?? card.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
          emotion_assets: createdCharacter.emotion_assets ?? card.emotion_assets,
          emotion_model: createdCharacter.emotion_model ?? card.emotion_model,
          emotion_prompt_lock: createdCharacter.emotion_prompt_lock ?? card.emotion_prompt_lock,
        }
      }
      if (gameId === null) {
        const created = await createStoryGame({
          token: authToken,
          title: normalizedTitle,
          description: normalizedDescription,
          opening_scene: normalizedOpeningScene,
          visibility: 'private',
          age_rating: ageRating,
          genres,
          cover_image_url: preparedCoverImageUrl,
          cover_scale: coverScale,
          cover_position_x: coverPositionX,
          cover_position_y: coverPositionY,
        })
        gameId = created.id
      }
      const latest = await getStoryGame({ token: authToken, gameId })
      const existingInstructionById = new Map(latest.instruction_cards.map((card) => [card.id, card]))
      for (const card of instructionCards) {
        if (card.id && existingInstructionById.has(card.id)) await updateStoryInstructionCard({ token: authToken, gameId, instructionId: card.id, title: card.title, content: card.content })
        else await createStoryInstructionCard({ token: authToken, gameId, title: card.title, content: card.content })
      }
      for (const card of latest.instruction_cards) if (!instructionCards.some((item) => item.id === card.id)) await deleteStoryInstructionCard({ token: authToken, gameId, instructionId: card.id })
      const existingPlotById = new Map(latest.plot_cards.map((card) => [card.id, card]))
      for (const card of plotCards) {
        const desiredEnabled = Boolean(card.is_enabled)
        const normalizedTriggers = parseOptionalTriggers(card.triggers ?? '')
        if (card.id && existingPlotById.has(card.id)) {
          await updateStoryPlotCard({
            token: authToken,
            gameId,
            cardId: card.id,
            title: card.title,
            content: card.content,
            triggers: normalizedTriggers,
            is_enabled: desiredEnabled,
          })
        } else {
          await createStoryPlotCard({
            token: authToken,
            gameId,
            title: card.title,
            content: card.content,
            triggers: normalizedTriggers,
            is_enabled: desiredEnabled,
          })
        }
      }
      for (const card of latest.plot_cards) if (!plotCards.some((item) => item.id === card.id)) await deleteStoryPlotCard({ token: authToken, gameId, cardId: card.id })
      const existingWorldProfile = latest.world_cards.find((card) => card.kind === 'world_profile') ?? null
      if (worldProfile) {
        const preparedWorldProfileBannerUrl = await prepareWorldBannerForRequest(worldProfile.avatar_url)
        const worldProfileTargetId = existingWorldProfile?.id ?? worldProfile.id
        if (worldProfileTargetId) {
          await updateStoryWorldCard({
            token: authToken,
            gameId,
            cardId: worldProfileTargetId,
            title: worldProfile.title,
            content: worldProfile.content,
            triggers: parseTriggers('', worldProfile.title),
            memory_turns: null,
          })
          await updateStoryWorldCardAvatar({
            token: authToken,
            gameId,
            cardId: worldProfileTargetId,
            avatar_url: preparedWorldProfileBannerUrl,
            avatar_original_url: worldProfile.avatar_original_url ?? worldProfile.avatar_url,
            avatar_scale: worldProfile.avatar_scale,
          })
        } else {
          await createStoryWorldCard({
            token: authToken,
            gameId,
            kind: 'world_profile',
            title: worldProfile.title,
            content: worldProfile.content,
            triggers: parseTriggers('', worldProfile.title),
            avatar_url: preparedWorldProfileBannerUrl,
            avatar_original_url: worldProfile.avatar_original_url ?? worldProfile.avatar_url,
            avatar_scale: worldProfile.avatar_scale,
            memory_turns: null,
          })
        }
      } else if (existingWorldProfile) {
        await deleteStoryWorldCard({ token: authToken, gameId, cardId: existingWorldProfile.id })
      }
      const resolvedMainHero = isMyPublicationsEdit ? null : await ensureLinkedCharacter(mainHero)
      const resolvedNpcs: EditableCharacterCard[] = []
      for (const npc of npcs) {
        resolvedNpcs.push((await ensureLinkedCharacter(npc)) ?? npc)
      }
      if (!isMyGamesEdit && !isMyPublicationsEdit) {
        const existingMainHero = latest.world_cards.find((card) => card.kind === 'main_hero') ?? null
        if (resolvedMainHero) {
          const preparedMainHeroAvatarUrl = await prepareAvatarForRequest(resolvedMainHero.avatar_url)
          if (existingMainHero) {
            await updateStoryWorldCard({
              token: authToken,
              gameId,
              cardId: existingMainHero.id,
              title: resolvedMainHero.name,
              content: resolvedMainHero.description,
              race: normalizeCharacterRace(resolvedMainHero.race),
              clothing: normalizeCharacterAdditionalField(resolvedMainHero.clothing),
              inventory: normalizeCharacterAdditionalField(resolvedMainHero.inventory),
              health_status: normalizeCharacterAdditionalField(resolvedMainHero.health_status),
              triggers: parseTriggers(resolvedMainHero.triggers, resolvedMainHero.name),
              character_id: resolvedMainHero.character_id ?? null,
            })
            await updateStoryWorldCardAvatar({
              token: authToken,
              gameId,
              cardId: existingMainHero.id,
              avatar_url: preparedMainHeroAvatarUrl,
              avatar_original_url: resolvedMainHero.avatar_original_url ?? resolvedMainHero.avatar_url,
              avatar_scale: resolvedMainHero.avatar_scale,
            })
          } else {
            await createStoryWorldCard({
              token: authToken,
              gameId,
              kind: 'main_hero',
              title: resolvedMainHero.name,
              content: resolvedMainHero.description,
              race: normalizeCharacterRace(resolvedMainHero.race),
              clothing: normalizeCharacterAdditionalField(resolvedMainHero.clothing),
              inventory: normalizeCharacterAdditionalField(resolvedMainHero.inventory),
              health_status: normalizeCharacterAdditionalField(resolvedMainHero.health_status),
              triggers: parseTriggers(resolvedMainHero.triggers, resolvedMainHero.name),
              avatar_url: preparedMainHeroAvatarUrl,
              avatar_original_url: resolvedMainHero.avatar_original_url ?? resolvedMainHero.avatar_url,
              avatar_scale: resolvedMainHero.avatar_scale,
              character_id: resolvedMainHero.character_id ?? null,
            })
          }
        } else if (existingMainHero) {
          await deleteStoryWorldCard({
            token: authToken,
            gameId,
            cardId: existingMainHero.id,
            allowMainHeroDelete: false,
          })
        }
      }
      const existingNpcs = latest.world_cards.filter((card) => card.kind === 'npc')
      for (const npc of resolvedNpcs) {
        const preparedNpcAvatarUrl = await prepareAvatarForRequest(npc.avatar_url)
        if (npc.id && existingNpcs.some((item) => item.id === npc.id)) {
          await updateStoryWorldCard({
            token: authToken,
            gameId,
            cardId: npc.id,
            title: npc.name,
            content: npc.description,
            race: normalizeCharacterRace(npc.race),
            clothing: normalizeCharacterAdditionalField(npc.clothing),
            inventory: normalizeCharacterAdditionalField(npc.inventory),
            health_status: normalizeCharacterAdditionalField(npc.health_status),
            triggers: parseTriggers(npc.triggers, npc.name),
            character_id: npc.character_id ?? null,
          })
          await updateStoryWorldCardAvatar({
            token: authToken,
            gameId,
            cardId: npc.id,
            avatar_url: preparedNpcAvatarUrl,
            avatar_original_url: npc.avatar_original_url ?? npc.avatar_url,
            avatar_scale: npc.avatar_scale,
          })
        } else {
          await createStoryWorldCard({
            token: authToken,
            gameId,
            kind: 'npc',
            title: npc.name,
            content: npc.description,
            race: normalizeCharacterRace(npc.race),
            clothing: normalizeCharacterAdditionalField(npc.clothing),
            inventory: normalizeCharacterAdditionalField(npc.inventory),
            health_status: normalizeCharacterAdditionalField(npc.health_status),
            triggers: parseTriggers(npc.triggers, npc.name),
            avatar_url: preparedNpcAvatarUrl,
            avatar_original_url: npc.avatar_original_url ?? npc.avatar_url,
            avatar_scale: npc.avatar_scale,
            character_id: npc.character_id ?? null,
          })
        }
      }
      for (const npc of existingNpcs) if (!npcs.some((item) => item.id === npc.id)) await deleteStoryWorldCard({ token: authToken, gameId, cardId: npc.id })
      await updateStoryGameMeta({
        token: authToken,
        gameId,
        title: normalizedTitle,
        description: normalizedDescription,
        opening_scene: normalizedOpeningScene,
        visibility,
        age_rating: ageRating,
        genres,
        cover_image_url: preparedCoverImageUrl,
        cover_scale: coverScale,
        cover_position_x: coverPositionX,
        cover_position_y: coverPositionY,
      })
      persistTitleForGame(gameId, normalizedTitle)
      localStorage.setItem(
        QUICK_START_WORLD_STORAGE_KEY,
        JSON.stringify({
          gameId,
          title: normalizedTitle,
          opening_scene: normalizedOpeningScene,
          description: normalizedDescription,
        }),
      )
      try {
        localStorage.removeItem(buildCommunityFeedCacheKey(user.id))
      } catch {
        // Ignore storage restrictions.
      }
      onNavigate(`/home/${gameId}`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось сохранить мир')
    } finally {
      setIsSubmitting(false)
    }
  }, [ageRating, authToken, canSubmit, coverImageUrl, coverPositionX, coverPositionY, coverScale, description, genres, hasTemplateConflicts, instructionCards, isMyGamesEdit, isMyPublicationsEdit, mainHero, npcs, onNavigate, openingScene, persistTitleForGame, plotCards, resolvedEditingGameId, shouldConfirmPublishWithoutMainHero, title, user.id, visibility, worldProfile])

  const helpEmpty = (text: string) => (
    <Box sx={{ borderRadius: '12px', border: `var(--morius-border-width) dashed rgba(170, 188, 214, 0.34)`, background: 'var(--morius-elevated-bg)', p: 1.1 }}><Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>{text}</Typography></Box>
  )

  const handleCloseTopUpDialog = useCallback(() => {
    setTopUpDialogOpen(false)
    setTopUpError('')
    setActivePlanPurchaseId(null)
  }, [])

  const handleOpenTopUpDialog = useCallback(() => {
    setTopUpError('')
    setTopUpDialogOpen(true)
  }, [])

  const loadTopUpPlans = useCallback(async () => {
    setIsTopUpPlansLoading(true)
    setTopUpError('')
    try {
      const plans = await getCoinTopUpPlans()
      setTopUpPlans(plans)
      setHasTopUpPlansLoaded(true)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить пакеты солов'
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

  const handlePurchaseTopUpPlan = useCallback(
    async (planId: string) => {
      setActivePlanPurchaseId(planId)
      setTopUpError('')
      try {
        const response = await createCoinTopUpPayment({
          token: authToken,
          plan_id: planId,
        })
        const paymentUrl = String(response.confirmation_url || '').trim()
        if (!paymentUrl) {
          throw new Error('Платёжная ссылка не получена')
        }
        window.location.assign(paymentUrl)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось открыть оплату'
        setTopUpError(detail)
      } finally {
        setActivePlanPurchaseId(null)
      }
    },
    [authToken],
  )

  return (
    <Box sx={{ minHeight: '100svh', color: APP_TEXT_PRIMARY, background: APP_PAGE_BACKGROUND }}>
      <AppHeader
        isPageMenuOpen={isPageMenuOpen}
        onTogglePageMenu={() => setIsPageMenuOpen((p) => !p)}
        onClosePageMenu={() => setIsPageMenuOpen(false)}
        mobileActionItems={buildUnifiedMobileQuickActions({
          onContinue: () => onNavigate('/dashboard?mobileAction=continue'),
          onQuickStart: () => onNavigate('/dashboard?mobileAction=quick-start'),
          onCreateWorld: () => onNavigate('/worlds/new'),
          onOpenShop: handleOpenTopUpDialog,
        })}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: false, onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', isActive: false, onClick: () => onNavigate('/games') },
          { key: 'games-publications', label: 'Мои публикации', isActive: false, onClick: () => onNavigate('/games/publications') },
          {
            key: isEditMode ? 'community-worlds' : 'world-create',
            label: isEditMode ? '\u0421\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e' : '\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u043c\u0438\u0440\u0430',
            isActive: !isEditMode,
            onClick: () => onNavigate(isEditMode ? '/games/all' : '/worlds/new'),
          },
        ]}
        pageMenuLabels={{ expanded: 'Свернуть меню', collapsed: 'Открыть меню' }}
        isRightPanelOpen={isHeaderActionsOpen}
        onToggleRightPanel={() => setIsHeaderActionsOpen((p) => !p)}
        rightToggleLabels={{ expanded: 'Скрыть действия', collapsed: 'Показать действия' }}
        onOpenTopUpDialog={handleOpenTopUpDialog}
        rightActions={
          <HeaderAccountActions
            user={user}
            authToken={authToken}
            avatarSize={HEADER_AVATAR_SIZE}
            onOpenProfile={() => onNavigate('/profile')}
          />
        }
      />
      <Box sx={{ pt: '86px', px: { xs: 2, md: 3 }, pb: { xs: 'calc(88px + env(safe-area-inset-bottom))', md: 4 } }}>
        <Box sx={{ maxWidth: 1160, mx: 'auto', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, borderRadius: 'var(--morius-radius)', background: APP_CARD_BACKGROUND, p: { xs: 1.4, md: 1.8 } }}>
          {errorMessage ? <Alert severity="error" onClose={() => setErrorMessage('')} sx={{ mb: 1.4, borderRadius: '12px' }}>{errorMessage}</Alert> : null}
          {isLoading ? <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress /></Stack> : <Stack spacing={2.2}>
            <Stack data-tour-id="world-create-cover" spacing={0.95} sx={{ scrollMarginTop: '120px' }}>
              <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleCoverUpload} style={{ display: 'none' }} />
              <input
                ref={worldProfileBannerInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleWorldProfileBannerUpload}
                style={{ display: 'none' }}
              />
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  '&:hover .morius-cover-delete': {
                    opacity: 1,
                    transform: 'translateY(0)',
                  },
                  '&:hover .morius-cover-shade': {
                    opacity: 1,
                  },
                }}
              >
                <Button
                  onClick={() => {
                    if (coverImageUrl) {
                      openCoverCropEditor()
                      return
                    }
                    coverInputRef.current?.click()
                  }}
                  sx={{
                    p: 0,
                    width: '100%',
                    borderRadius: '12px',
                    border: 'var(--morius-border-width) dashed color-mix(in srgb, var(--morius-card-border) 72%, rgba(183, 205, 233, 0.45))',
                    overflow: 'hidden',
                    textTransform: 'none',
                  }}
                >
                  <Box
                    sx={{
                      width: '100%',
                      aspectRatio: '3 / 2',
                      position: 'relative',
                      background: coverImageUrl
                        ? 'transparent'
                        : 'linear-gradient(110deg, color-mix(in srgb, var(--morius-card-bg) 86%, #111925) 0%, color-mix(in srgb, var(--morius-elevated-bg) 74%, #404a5a) 100%)',
                    }}
                  >
                    {coverImageUrl ? (
                      <Box
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          backgroundImage: `url(${coverImageUrl})`,
                          backgroundSize: `${coverScale * 100}%`,
                          backgroundPosition: `${coverPositionX}% ${coverPositionY}%`,
                        }}
                      />
                    ) : null}
                    {coverImageUrl ? (
                      <Box
                        className="morius-cover-shade"
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          backgroundColor: 'rgba(8, 11, 16, 0.35)',
                          opacity: 0,
                          transition: 'opacity 170ms ease',
                        }}
                      />
                    ) : null}
                    <Stack sx={{ position: 'absolute', inset: 0 }} alignItems="center" justifyContent="center">
                      <Box
                        sx={{
                          width: 82,
                          height: 82,
                          borderRadius: '50%',
                          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-text-primary) 62%, transparent)',
                          background: 'color-mix(in srgb, var(--morius-card-bg) 60%, transparent)',
                          display: 'grid',
                          placeItems: 'center',
                          color: 'color-mix(in srgb, var(--morius-text-primary) 84%, #d8ebff)',
                          lineHeight: 1,
                        }}
                      >
                        {coverImageUrl ? (
                          <Box
                            component="img"
                            src={icons.communityEdit}
                            alt=""
                            aria-hidden
                            sx={{ width: 25, height: 25, filter: 'brightness(0) invert(1)', opacity: 0.93 }}
                          />
                        ) : (
                          <Typography component="span" sx={{ fontSize: '2.4rem', lineHeight: 1 }}>
                            +
                          </Typography>
                        )}
                      </Box>
                    </Stack>
                  </Box>
                </Button>
                {coverImageUrl ? (
                  <IconButton
                    className="morius-cover-delete"
                    onClick={(event) => {
                      event.stopPropagation()
                      setCoverImageUrl(null)
                    }}
                    sx={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      width: 36,
                      height: 36,
                      border: 'var(--morius-border-width) solid rgba(166, 183, 203, 0.4)',
                      backgroundColor: 'rgba(6, 10, 14, 0.72)',
                      color: 'rgba(246, 138, 138, 0.96)',
                      opacity: 0,
                      transform: 'translateY(-3px)',
                      transition: 'opacity 170ms ease, transform 170ms ease',
                      '&:hover': {
                        backgroundColor: 'rgba(9, 13, 19, 0.92)',
                      },
                    }}
                  >
                    <Box component="svg" viewBox="0 0 24 24" sx={{ width: 18, height: 18, fill: 'currentColor' }}>
                      <path d="M9 3h6l1 2h5v2H3V5h5l1-2Zm0 6h10l-1 11H10L9 9Z" />
                      <path d="M11 11h2v7h-2v-7Zm4 0h2v7h-2v-7Z" />
                    </Box>
                  </IconButton>
                ) : null}
              </Box>
              <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.78rem' }}>
                Не больше 2 МБ (изображение будет автоматически сжато для экономии)
              </Typography>
            </Stack>

            <Stack data-tour-id="world-create-main-info" spacing={1.05} sx={{ scrollMarginTop: '120px' }}>
              <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>О мире</Typography>
              <TextField
                label={<><Box component="span">Название мира</Box><Box component="span" sx={{ color: '#f05454' }}>*</Box></>}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                fullWidth
                inputProps={{ maxLength: 140, 'data-tour-id': 'world-create-title-input' }}
                helperText={<TextLimitIndicator currentLength={title.length} maxLength={140} />}
                FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
              />
              <TextField
                label="Описание мира"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                fullWidth
                multiline
                minRows={3}
                maxRows={8}
                inputProps={{ maxLength: 1000 }}
                helperText={<TextLimitIndicator currentLength={description.length} maxLength={1000} />}
                FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
              />
              {
                <Stack data-tour-id="world-create-opening-scene" spacing={0.75} sx={{ scrollMarginTop: '120px' }}>
                  <TextField
                    label="Вступительная сцена"
                    value={openingScene}
                    onChange={(e) => setOpeningScene(e.target.value)}
                    fullWidth
                    multiline
                    minRows={3}
                    maxRows={8}
                    inputRef={openingSceneInputRef}
                    inputProps={{ maxLength: OPENING_SCENE_MAX_LENGTH }}
                    helperText={<TextLimitIndicator currentLength={openingScene.length} maxLength={OPENING_SCENE_MAX_LENGTH} />}
                    FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                  />
                  <Box
                    sx={{
                      borderRadius: '12px',
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent)',
                      px: 1,
                      py: 0.9,
                    }}
                  >
                    <Stack spacing={0.75}>
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.81rem' }}>
                        Быстрые теги: выберите тип реплики, и тег вставится в курсор.
                      </Typography>
                      <TextField
                        label="Имя NPC для тегов"
                        value={openingSceneNpcName}
                        onChange={(event) => setOpeningSceneNpcName(event.target.value.slice(0, OPENING_SCENE_NPC_NAME_MAX_LENGTH))}
                        placeholder={OPENING_SCENE_NPC_FALLBACK_NAME}
                        fullWidth
                        size="small"
                      />
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 0.6 }}>
                        <Button
                          size="small"
                          onClick={() => insertOpeningSceneTag('gg_name')}
                          sx={OPENING_SCENE_TAG_BUTTON_SX}
                        >
                          ГГ
                        </Button>
                        <Button
                          size="small"
                          onClick={() => insertOpeningSceneTag('gg_speech')}
                          sx={OPENING_SCENE_TAG_BUTTON_SX}
                        >
                          GG реплика
                        </Button>
                        <Button
                          size="small"
                          onClick={() => insertOpeningSceneTag('gg_thought')}
                          sx={OPENING_SCENE_TAG_BUTTON_SX}
                        >
                          GG мысли
                        </Button>
                        <Button
                          size="small"
                          onClick={() => insertOpeningSceneTag('npc_speech')}
                          sx={OPENING_SCENE_TAG_BUTTON_SX}
                        >
                          NPC реплика
                        </Button>
                        <Button
                          size="small"
                          onClick={() => insertOpeningSceneTag('npc_thought')}
                          sx={OPENING_SCENE_TAG_BUTTON_SX}
                        >
                          NPC мысли
                        </Button>
                      </Box>
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.77rem' }}>
                        Кнопка «ГГ» вставляет имя главного героя. Пока ГГ не назначен, будет отображаться «Главный Герой».
                      </Typography>
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.77rem' }}>
                        Обычный текст можно писать как есть, он автоматически пойдет в повествование.
                      </Typography>
                    </Stack>
                  </Box>
                </Stack>
              }
            </Stack>

            <Stack data-tour-id="world-create-genres" spacing={1} sx={{ scrollMarginTop: '120px' }}>
              <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>Дополнительно</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7}>
                <TextField
                  value={genreSearch}
                  onChange={(e) => setGenreSearch(e.target.value)}
                  placeholder="Начните вводить теги"
                  fullWidth
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem', lineHeight: 1 }}>{'\u2022'}</Typography>
                      </InputAdornment>
                    ),
                  }}
                />
                <TextField
                  select
                  value={ageRating}
                  onChange={(event) => setAgeRating(event.target.value as StoryAgeRating)}
                  sx={{ width: { xs: '100%', sm: 92 }, '& .MuiInputBase-root': { height: 46 } }}
                >
                  {AGE_RATING_OPTIONS.map((option) => (
                    <MenuItem key={option} value={option}>{option}</MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.65 }}>
                {visibleGenres.map((genre) => {
                  const isSelected = genres.includes(genre)
                  const isLimitReached = !isSelected && genres.length >= MAX_WORLD_GENRES
                  return (
                    <Button
                      key={genre}
                      onClick={() => toggleGenre(genre)}
                      disabled={isLimitReached}
                      sx={{
                        minHeight: 32,
                        px: 1.04,
                        borderRadius: '999px',
                        textTransform: 'none',
                        border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                        backgroundColor: isSelected ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                        color: APP_TEXT_PRIMARY,
                        fontSize: '0.84rem',
                        '&:disabled': {
                          color: APP_TEXT_SECONDARY,
                          borderColor: APP_BORDER_COLOR,
                        },
                      }}
                    >
                      {genre}
                    </Button>
                  )
                })}
              </Box>
              <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem' }}>
                Выбрано: {genres.length}/{MAX_WORLD_GENRES}
              </Typography>
            </Stack>

            <Box data-tour-id="world-create-cards" sx={{ scrollMarginTop: '120px' }}>
              <Stack spacing={0.85}>
                <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>Инструкции</Typography>
                {instructionCards.length > 0 ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {instructionCards.map((card) => (
                      <CompactCard
                        key={card.localId}
                        title={card.title}
                        content={replacePlotMainHeroTags(card.content, mainHero?.name)}
                        badge="активна"
                        actions={
                          <>
                            <Button onClick={() => openCardDialog('instruction', card)} sx={{ minHeight: 30, px: 1.05 }}>Изменить</Button>
                            <Button onClick={() => setInstructionCards((p) => p.filter((i) => i.localId !== card.localId))} sx={{ minHeight: 30, px: 1.05, color: APP_TEXT_SECONDARY }}>Удалить</Button>
                          </>
                        }
                      />
                    ))}
                  </Box>
                ) : null}
                <TemplateButtonsCard
                  title="Карточки инструкций"
                  subtitle="Слева — новая карточка, справа — выбор из шаблонов."
                  onCreate={() => openCardDialog('instruction')}
                  onTemplate={() => setInstructionTemplateDialogOpen(true)}
                />
              </Stack>

              <Stack spacing={0.85} sx={{ mt: 2.2 }}>
                <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>Сюжет</Typography>
                {plotCards.length === 0 ? (
                  <EmptyAddCard onClick={() => openCardDialog('plot')} label="Добавить карточку" />
                ) : (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {plotCards.map((card) => (
                      <CompactCard
                        key={card.localId}
                        title={card.title}
                        content={`${replacePlotMainHeroTags(card.content, mainHero?.name)}${card.triggers?.trim() ? `\nТриггеры: ${card.triggers.trim()}` : ''}`}
                        badge={card.is_enabled ? 'активна' : 'выключена'}
                        actions={
                          <>
                            <Button onClick={() => openCardDialog('plot', card)} sx={{ minHeight: 30, px: 1.05 }}>Изменить</Button>
                            <Button onClick={() => setPlotCards((p) => p.filter((i) => i.localId !== card.localId))} sx={{ minHeight: 30, px: 1.05, color: APP_TEXT_SECONDARY }}>Удалить</Button>
                          </>
                        }
                      />
                    ))}
                  </Box>
                )}
                {plotCards.length > 0 ? <Button onClick={() => openCardDialog('plot')} sx={{ minHeight: 34, width: 'fit-content' }}>Добавить</Button> : null}
              </Stack>

              <Stack spacing={0.9} sx={{ mt: 2.2 }}>
                <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>Мир</Typography>
                {worldProfile ? (
                  <Box sx={{ width: { xs: '100%', sm: 380 }, maxWidth: '100%' }}>
                    <CharacterShowcaseCard
                      title={worldProfile.title}
                      description={worldProfile.content}
                      imageUrl={worldProfile.avatar_url}
                      imageScale={worldProfile.avatar_scale}
                      eyebrow="Описание мира"
                      metaPrimary="Всегда в памяти"
                      footerHint="Лор, правила, расы и общая атмосфера мира."
                      descriptionLineClamp={4}
                      minHeight={304}
                      onClick={() => openWorldProfileDialog(worldProfile)}
                    />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7} sx={{ mt: 0.9 }}>
                      <Button onClick={() => openWorldProfileDialog(worldProfile)} sx={{ minHeight: 34, flex: 1 }}>
                        Изменить
                      </Button>
                      <Button onClick={() => setWorldProfileTemplatePickerOpen(true)} sx={{ minHeight: 34, flex: 1 }}>
                        Из шаблона
                      </Button>
                      <Button onClick={() => setWorldProfile(null)} sx={{ minHeight: 34, flex: 1, color: APP_TEXT_SECONDARY }}>
                        Убрать
                      </Button>
                    </Stack>
                  </Box>
                ) : (
                  <EmptyAddCard
                    onClick={() => openWorldProfileDialog()}
                    label="Добавить карточку мира"
                    actions={[
                      { label: 'Создать', onClick: () => openWorldProfileDialog() },
                      { label: 'Из шаблона', onClick: () => setWorldProfileTemplatePickerOpen(true) },
                    ]}
                  />
                )}
              </Stack>

              <Stack spacing={0.9} sx={{ mt: 2.2 }}>
                <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>Персонажи</Typography>
                {!isMyGamesEdit && !isMyPublicationsEdit ? (
                  <Stack spacing={0.7}>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontWeight: 700, fontSize: '0.95rem' }}>Главный герой</Typography>
                    {mainHero ? (
                      <CompactCard
                        title={mainHero.name}
                        content={`${mainHero.description}${mainHero.triggers.trim() ? `\nТриггеры: ${mainHero.triggers.trim()}` : ''}`}
                        badge="гг"
                        noteBadge={mainHero.note}
                        avatar={<MiniAvatar avatarUrl={mainHero.avatar_url} avatarScale={mainHero.avatar_scale} label={mainHero.name} size={38} />}
                        actions={
                          <>
                            <Button onClick={() => void openCharacterManagerForEdit('main_hero', mainHero)} disabled={isOpeningCharacterManager} sx={{ minHeight: 30, px: 1.05 }}>Изменить</Button>
                            <Button onClick={() => setMainHero(null)} sx={{ minHeight: 30, px: 1.05, color: APP_TEXT_SECONDARY }}>Убрать</Button>
                          </>
                        }
                      />
                    ) : null}
                    {!mainHero ? (
                      <StandardCreateButtonsRow
                        onCreate={() => openCharacterManagerForCreate('main_hero')}
                        onTemplate={() => setCharacterPickerTarget('main_hero')}
                      />
                    ) : null}
                  </Stack>
                ) : null}

                <Stack spacing={0.7}>
                  <Typography sx={{ color: APP_TEXT_SECONDARY, fontWeight: 700, fontSize: '0.95rem' }}>NPC</Typography>
                  {npcs.length > 0 ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {npcs.map((npc) => (
                        <CompactCard
                          key={npc.localId}
                          title={npc.name}
                          content={`${npc.description}${npc.triggers.trim() ? `\nТриггеры: ${npc.triggers.trim()}` : ''}`}
                          badge="npc"
                          noteBadge={npc.note}
                          avatar={<MiniAvatar avatarUrl={npc.avatar_url} avatarScale={npc.avatar_scale} label={npc.name} size={38} />}
                          actions={
                            <>
                              <Button onClick={() => void openCharacterManagerForEdit('npc', npc)} disabled={isOpeningCharacterManager} sx={{ minHeight: 30, px: 1.05 }}>Изменить</Button>
                              <Button onClick={() => setNpcs((p) => p.filter((i) => i.localId !== npc.localId))} sx={{ minHeight: 30, px: 1.05, color: APP_TEXT_SECONDARY }}>Удалить</Button>
                            </>
                          }
                        />
                      ))}
                    </Box>
                  ) : null}
                  <StandardCreateButtonsRow
                    onCreate={() => openCharacterManagerForCreate('npc')}
                    onTemplate={() => setCharacterPickerTarget('npc')}
                  />
                </Stack>
              </Stack>
            </Box>

            <Stack data-tour-id="world-create-visibility" spacing={0.9} sx={{ scrollMarginTop: '120px' }}>
              <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>Параметры доступа</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                <Button
                  onClick={() => setVisibility('private')}
                  sx={{
                    minHeight: 44,
                    flex: 1,
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: visibility === 'private' ? 'var(--morius-accent)' : APP_TEXT_SECONDARY,
                    fontWeight: visibility === 'private' ? 800 : 650,
                    textTransform: 'none',
                    '&:hover': { backgroundColor: 'transparent' },
                  }}
                >
                  Частный
                </Button>
                <Button
                  onClick={() => setVisibility('public')}
                  sx={{
                    minHeight: 44,
                    flex: 1,
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: visibility === 'public' ? 'var(--morius-accent)' : APP_TEXT_SECONDARY,
                    fontWeight: visibility === 'public' ? 800 : 650,
                    textTransform: 'none',
                    '&:hover': { backgroundColor: 'transparent' },
                  }}
                >
                  Публичный
                </Button>
              </Stack>
            </Stack>

            <Stack direction="row" spacing={0.8} justifyContent="flex-end" sx={{ pt: 0.6 }}>
              <Button onClick={() => onNavigate('/games')} sx={{ minHeight: 38, color: APP_TEXT_SECONDARY }}>Отмена</Button>
              <Button
                data-tour-id="world-create-submit"
                onClick={() => void handleSaveWorld()}
                disabled={!canSubmit}
                sx={{
                  minHeight: 38,
                  color: 'var(--morius-accent)',
                  backgroundColor: 'transparent',
                  '&:hover': { backgroundColor: 'rgba(255,255,255,0.04)' },
                }}
              >
                {isSubmitting ? <CircularProgress size={16} sx={{ color: 'var(--morius-accent)' }} /> : isEditMode ? 'Сохранить' : visibility === 'public' ? 'Опубликовать' : 'Создать'}
              </Button>
            </Stack>
          </Stack>}
        </Box>
      </Box>

      <BaseDialog
        open={isPublishWithoutMainHeroDialogOpen}
        onClose={() => {
          if (isSubmitting) {
            return
          }
          setIsPublishWithoutMainHeroDialogOpen(false)
          publishWithoutMainHeroConfirmedRef.current = false
        }}
        maxWidth="sm"
        paperSx={dialogPaperSx}
        header={
          <Stack spacing={0.5}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.35rem' }}>Публикация без главного героя</Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.92rem' }}>
              В публичных мирах карточка ГГ не публикуется.
            </Typography>
          </Stack>
        }
        actions={
          <Stack direction="row" spacing={0.8} justifyContent="flex-end" sx={{ width: '100%' }}>
            <Button
              onClick={() => {
                setIsPublishWithoutMainHeroDialogOpen(false)
                publishWithoutMainHeroConfirmedRef.current = false
              }}
              disabled={isSubmitting}
              sx={{ color: APP_TEXT_SECONDARY }}
            >
              Отмена
            </Button>
            <Button
              onClick={() => {
                publishWithoutMainHeroConfirmedRef.current = true
                setIsPublishWithoutMainHeroDialogOpen(false)
                void handleSaveWorld()
              }}
              disabled={isSubmitting}
              sx={{
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_BUTTON_ACTIVE,
                '&:hover': { backgroundColor: APP_BUTTON_HOVER },
              }}
            >
              Ок
            </Button>
          </Stack>
        }
      >
        <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.92rem', lineHeight: 1.5 }}>
          Если продолжить, ГГ останется только в вашем приватном мире. В опубликованной версии он будет удален автоматически.
        </Typography>
      </BaseDialog>

      <FormDialog
        open={cardDialogOpen}
        onClose={() => setCardDialogOpen(false)}
        onSubmit={saveCardDialog}
        title={cardDialogKind === 'instruction' ? 'Карточка инструкции' : 'Карточка сюжета'}
        description="Заполните карточку. Пустые карточки не сохраняются."
        maxWidth="sm"
        paperSx={dialogPaperSx}
        titleSx={{ pb: 0.85 }}
        contentSx={{ pt: 0.4 }}
        actionsSx={{ px: 3, pb: 2.2 }}
        cancelButtonSx={{ color: APP_TEXT_SECONDARY }}
        submitButtonSx={{
          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
          backgroundColor: APP_BUTTON_ACTIVE,
          '&:hover': { backgroundColor: APP_BUTTON_HOVER },
        }}
        submitDisabled={!cardTitleDraft.trim() || !cardContentDraft.trim()}
      >

          <Stack spacing={1}>
            <TextField
              label="Заголовок"
              value={cardTitleDraft}
              onChange={(e) => setCardTitleDraft(e.target.value)}
              fullWidth
              inputProps={{ maxLength: 140 }}
              helperText={<TextLimitIndicator currentLength={cardTitleDraft.length} maxLength={140} />}
              FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
            />
            <TextField
              label="Содержание"
              value={cardContentDraft}
              onChange={(e) => setCardContentDraft(e.target.value)}
              fullWidth
              multiline
              minRows={4}
              maxRows={10}
              inputProps={{ maxLength: 6000 }}
              helperText={<TextLimitIndicator currentLength={cardContentDraft.length} maxLength={6000} />}
              FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
            />
            {cardDialogKind === 'plot' ? (
              <TextField
                label="Триггеры (необязательно)"
                value={cardTriggersDraft}
                onChange={(e) => setCardTriggersDraft(e.target.value.slice(0, STORY_TRIGGER_INPUT_MAX_LENGTH))}
                fullWidth
                inputProps={{ maxLength: STORY_TRIGGER_INPUT_MAX_LENGTH }}
                placeholder="Через запятую: артефакт, клятва, договор"
                helperText={<TextLimitIndicator currentLength={cardTriggersDraft.length} maxLength={STORY_TRIGGER_INPUT_MAX_LENGTH} />}
                FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
              />
            ) : null}
            {cardDialogKind === 'plot' ? (
              <Button
                type="button"
                onClick={() => setCardIsEnabledDraft((prev) => !prev)}
                sx={{
                  minHeight: 38,
                  width: 'fit-content',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  backgroundColor: cardIsEnabledDraft ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                  '&:hover': { backgroundColor: cardIsEnabledDraft ? APP_BUTTON_HOVER : 'var(--morius-elevated-bg)' },
                }}
              >
                {`Активно по умолчанию: ${cardIsEnabledDraft ? 'включено' : 'выключено'}`}
              </Button>
            ) : null}
            {!cardTitleDraft.trim() || !cardContentDraft.trim() ? <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.83rem' }}>Введите заголовок и текст карточки, чтобы кнопка сохранения стала доступна.</Typography> : null}
          </Stack>
        
      </FormDialog>

      <FormDialog
        open={worldProfileDialogOpen}
        onClose={closeWorldProfileDialog}
        onSubmit={saveWorldProfileDialog}
        title="Карточка мира"
        maxWidth="sm"
        paperSx={dialogPaperSx}
        titleSx={{ pb: 0.85 }}
        contentSx={{ pt: 0.4, overflowY: 'auto' }}
        actionsSx={{ px: 3, pb: 2.2 }}
        cancelButtonSx={{ color: 'var(--morius-title-text)' }}
        submitButtonSx={{
          color: 'var(--morius-accent)',
        }}
        submitDisabled={!worldProfileTitleDraft.trim() || !worldProfileContentDraft.trim()}
      >
        <Stack spacing={1}>
          <WorldCardBannerPreview
            imageUrl={worldProfileAvatarUrlDraft}
            imageScale={worldProfileAvatarScaleDraft || 1}
            title="Баннер мира"
            description="Широкое изображение для карточки лора. Можно загрузить новое или перекадрировать текущее."
            actionLabel={worldProfileAvatarUrlDraft ? 'Перекадрировать баннер' : 'Выбрать баннер'}
            onClick={openWorldProfileCropEditor}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7}>
            <Button
              onClick={() => worldProfileBannerInputRef.current?.click()}
              sx={{ minHeight: 36, flex: 1 }}
            >
              {worldProfileAvatarUrlDraft ? 'Заменить баннер' : 'Загрузить баннер'}
            </Button>
            <Button
              onClick={openWorldProfileCropEditor}
              sx={{ minHeight: 36, flex: 1 }}
            >
              {worldProfileAvatarUrlDraft ? 'Перекадрировать' : 'Выбрать баннер'}
            </Button>
            {worldProfileAvatarUrlDraft ? (
              <Button
                onClick={() => {
                  setWorldProfileAvatarUrlDraft(null)
                  setWorldProfileAvatarOriginalUrlDraft(null)
                  setWorldProfileAvatarScaleDraft(1)
                }}
                sx={{ minHeight: 36, flex: 1, color: APP_TEXT_SECONDARY }}
              >
                Убрать
              </Button>
            ) : null}
          </Stack>

          <Box sx={{ display: 'none' }}>
            Эту карточку мы помним всегда. В ней лучше описывать лор мира, его правила, устройства, расы и ограничения.
          </Box>

          <TextField
            label="Название мира"
            value={worldProfileTitleDraft}
            onChange={(event) => setWorldProfileTitleDraft(event.target.value)}
            fullWidth
            inputProps={{ maxLength: WORLD_PROFILE_TITLE_MAX_LENGTH }}
            helperText={<TextLimitIndicator currentLength={worldProfileTitleDraft.length} maxLength={WORLD_PROFILE_TITLE_MAX_LENGTH} />}
            FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
          />
          <TextField
            label="Описание мира"
            value={worldProfileContentDraft}
            onChange={(event) => setWorldProfileContentDraft(event.target.value)}
            fullWidth
            multiline
            minRows={6}
            maxRows={12}
            inputProps={{ maxLength: WORLD_PROFILE_CONTENT_MAX_LENGTH }}
            helperText={<TextLimitIndicator currentLength={worldProfileContentDraft.length} maxLength={WORLD_PROFILE_CONTENT_MAX_LENGTH} />}
            FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
          />
        </Stack>
      </FormDialog>

      <WorldCardTemplatePickerDialog
        open={worldProfileTemplatePickerOpen}
        authToken={authToken}
        kind="world_profile"
        title="Шаблоны мира"
        emptyTitle="Шаблонов мира пока нет"
        emptyDescription="Создайте карточки мира в профиле, и потом их можно будет быстро подставлять сюда."
        onClose={() => setWorldProfileTemplatePickerOpen(false)}
        onSelectTemplate={handleApplyWorldProfileTemplate}
      />

      <BaseDialog
        open={characterPickerTarget !== null}
        onClose={() => setCharacterPickerTarget(null)}
        maxWidth="sm"
        paperSx={dialogPaperSx}
        titleSx={{ pb: 0.75 }}
        contentSx={{ pt: 0.35 }}
        actionsSx={{ px: 3, pb: 2.2 }}
        header={

          <Stack spacing={0.3}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.45rem' }}>{characterPickerTarget === 'main_hero' ? 'Выбрать главного героя' : 'Выбрать NPC'}</Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>Выберите персонажа из ваших заготовок. Дубли между ГГ и NPC запрещены.</Typography>
          </Stack>
        
        }
        actions={

          <Button onClick={() => setCharacterPickerTarget(null)} disabled={savingCommunityCharacterId !== null} sx={{ color: APP_TEXT_SECONDARY }}>Закрыть</Button>
        
        }
      >

          <Stack spacing={0.8}>
            <Stack direction="row" spacing={0.8}>
              <Button
                onClick={() => setCharacterPickerSourceTab('my')}
                disabled={savingCommunityCharacterId !== null}
                sx={{
                  minHeight: 34,
                  borderRadius: '10px',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  backgroundColor: characterPickerSourceTab === 'my' ? APP_BUTTON_ACTIVE : 'var(--morius-elevated-bg)',
                  color: APP_TEXT_PRIMARY,
                  textTransform: 'none',
                  '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                }}
              >
                Мои персонажи
              </Button>
              <Button
                onClick={() => setCharacterPickerSourceTab('community')}
                disabled={savingCommunityCharacterId !== null}
                sx={{
                  minHeight: 34,
                  borderRadius: '10px',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  backgroundColor: characterPickerSourceTab === 'community' ? APP_BUTTON_ACTIVE : 'var(--morius-elevated-bg)',
                  color: APP_TEXT_PRIMARY,
                  textTransform: 'none',
                  '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                }}
              >
                Сообщество
              </Button>
            </Stack>

            <Box
              component="input"
              value={characterPickerSearchQuery}
              placeholder="Поиск по имени, расе, описанию, заметкам и автору"
              onChange={(event: ChangeEvent<HTMLInputElement>) => setCharacterPickerSearchQuery(event.target.value.slice(0, 240))}
              sx={{
                width: '100%',
                minHeight: 38,
                borderRadius: 'var(--morius-radius)',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                color: APP_TEXT_PRIMARY,
                px: 1.1,
                outline: 'none',
                fontSize: '0.9rem',
              }}
            />

            {characterPickerSourceTab === 'community' ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                <Box
                  component="select"
                  value={characterPickerAddedFilter}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setCharacterPickerAddedFilter(event.target.value as CommunityAddedFilter)
                  }
                  sx={{
                    flex: 1,
                    minHeight: 36,
                    borderRadius: '10px',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: 'var(--morius-elevated-bg)',
                    color: APP_TEXT_PRIMARY,
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
                  value={characterPickerSortMode}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setCharacterPickerSortMode(event.target.value as CommunitySortMode)
                  }
                  sx={{
                    flex: 1,
                    minHeight: 36,
                    borderRadius: '10px',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: 'var(--morius-elevated-bg)',
                    color: APP_TEXT_PRIMARY,
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
              {characterPickerSourceTab === 'my' ? (
                <Stack spacing={0.75}>
                  {filteredOwnCharacterOptions.length === 0
                    ? helpEmpty(characterPickerSearchQuery ? 'Персонажи не найдены.' : 'У вас пока нет сохранённых персонажей. Сначала добавьте их в разделе «Мои персонажи».')
                    : filteredOwnCharacterOptions.map((character) => {
                        const disabledReason = characterPickerTarget ? getTemplateDisabledReason(character, characterPickerTarget) : null
                        return (
                          <Box key={character.id} sx={{ borderRadius: '12px', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, background: 'var(--morius-elevated-bg)', px: 0.85, py: 0.75 }}>
                            <Button
                              onClick={() => applyTemplate(character)}
                              disabled={Boolean(disabledReason) || savingCommunityCharacterId !== null}
                              sx={{ width: '100%', p: 0, textTransform: 'none', justifyContent: 'flex-start', border: 'none', '&:hover': { background: 'transparent' } }}
                            >
                              <Stack direction="row" spacing={0.8} alignItems="center" sx={{ width: '100%', textAlign: 'left' }}>
                                <MiniAvatar avatarUrl={character.avatar_url} avatarScale={character.avatar_scale} label={character.name} size={42} />
                                <Stack spacing={0.34} sx={{ minWidth: 0, flex: 1, alignItems: 'flex-start' }}>
                                  <Stack direction="row" spacing={0.55} alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
                                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 800, fontSize: '0.98rem', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 }}>{character.name}</Typography>
                                  </Stack>
                                  {character.note ? <CharacterNoteBadge note={character.note} maxWidth={100} /> : null}
                                  <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{character.description}</Typography>
                                </Stack>
                              </Stack>
                            </Button>
                            {disabledReason ? <Typography sx={{ color: 'rgba(240, 176, 176, 0.92)', fontSize: '0.76rem', mt: 0.55 }}>{disabledReason}</Typography> : null}
                          </Box>
                        )
                      })}
                </Stack>
              ) : isLoadingCommunityCharacterOptions ? (
                <Stack alignItems="center" justifyContent="center" sx={{ py: 3 }}>
                  <CircularProgress size={24} />
                </Stack>
              ) : filteredCommunityCharacterOptions.length === 0 ? (
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.88rem' }}>
                  Персонажи сообщества не найдены.
                </Typography>
              ) : (
                <Stack spacing={0.75}>
                  {filteredCommunityCharacterOptions.map((character) => {
                    const disabledReason = characterPickerTarget ? getCommunityTemplateDisabledReason(character, characterPickerTarget) : null
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
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          backgroundColor: isExpanded ? APP_BUTTON_HOVER : 'var(--morius-elevated-bg)',
                          px: 0.9,
                          py: 0.75,
                          cursor: 'pointer',
                        }}
                      >
                        <Stack spacing={0.35}>
                          <Stack direction="row" spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
                            <MiniAvatar avatarUrl={character.avatar_url} avatarScale={character.avatar_scale} label={character.name} size={34} />
                            <Stack spacing={0.34} sx={{ minWidth: 0, flex: 1, alignItems: 'flex-start' }}>
                              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
                                <Typography
                                  sx={{
                                    color: APP_TEXT_PRIMARY,
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
                              {character.community_additions_count} + / {character.community_rating_avg.toFixed(1)} ★
                            </Typography>
                            <Typography sx={{ fontSize: 'inherit', fontWeight: 700 }}>
                              {disabledReason ? disabledReason : character.is_added_by_user ? 'Сохранено' : 'Не сохранено'}
                            </Typography>
                          </Stack>
                          {isExpanded ? (
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7} sx={{ pt: 0.35 }}>
                              <Button
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setExpandedCommunityCharacterId(null)
                                }}
                                disabled={isSavingCommunityCharacter}
                                sx={{
                                  textTransform: 'none',
                                  minHeight: 34,
                                  borderRadius: '10px',
                                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                                  backgroundColor: 'transparent',
                                  color: APP_TEXT_SECONDARY,
                                  '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                                }}
                              >
                                Свернуть
                              </Button>
                              <Button
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleApplyCommunityTemplate(character, { saveToProfile: false })
                                }}
                                disabled={Boolean(disabledReason) || savingCommunityCharacterId !== null}
                                sx={{
                                  textTransform: 'none',
                                  minHeight: 34,
                                  borderRadius: '10px',
                                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                                  backgroundColor: 'transparent',
                                  color: APP_TEXT_PRIMARY,
                                  '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                                }}
                              >
                                {isSavingCommunityCharacter ? (
                                  <CircularProgress size={14} sx={{ color: APP_TEXT_PRIMARY }} />
                                ) : (
                                  'Добавить'
                                )}
                              </Button>
                              <Button
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleApplyCommunityTemplate(character, { saveToProfile: true })
                                }}
                                disabled={Boolean(disabledReason) || savingCommunityCharacterId !== null}
                                sx={{
                                  textTransform: 'none',
                                  minHeight: 34,
                                  borderRadius: '10px',
                                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                                  backgroundColor: 'transparent',
                                  color: APP_TEXT_PRIMARY,
                                  '&:hover': { backgroundColor: APP_BUTTON_HOVER },
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
        
      </BaseDialog>
      <CharacterManagerDialog
        open={characterManagerOpen}
        authToken={authToken}
        initialMode={characterManagerInitialMode}
        initialCharacterId={characterManagerInitialCharacterId}
        showEmotionTools={user.role === 'administrator'}
        onClose={handleCloseCharacterManager}
      />
      <InstructionTemplateDialog
        open={instructionTemplateDialogOpen}
        authToken={authToken}
        mode="picker"
        enableCommunityPicker
        selectedTemplateSignatures={selectedInstructionTemplateSignatures}
        onClose={() => setInstructionTemplateDialogOpen(false)}
        onSelectTemplate={(template) => handleApplyInstructionTemplate(template)}
      />

      {coverCropSource ? (
        <ImageCropper
          imageSrc={coverCropSource}
          aspect={3 / 2}
          frameRadius={12}
          title="Настройка обложки"
          onCancel={handleCancelCoverCrop}
          onSave={handleSaveCoverCrop}
        />
      ) : null}
      {worldProfileCropSource ? (
        <ImageCropper
          imageSrc={worldProfileCropSource}
          aspect={STORY_WORLD_BANNER_ASPECT}
          frameRadius={18}
          title="Настройка баннера мира"
          onCancel={handleCancelWorldProfileCrop}
          onSave={handleSaveWorldProfileCrop}
        />
      ) : null}
      <TopUpDialog
        open={topUpDialogOpen}
        topUpError={topUpError}
        isTopUpPlansLoading={isTopUpPlansLoading}
        topUpPlans={topUpPlans}
        activePlanPurchaseId={activePlanPurchaseId}
        onClose={handleCloseTopUpDialog}
        onPurchasePlan={handlePurchaseTopUpPlan}
      />
    </Box>
  )
}

export default WorldCreatePage
