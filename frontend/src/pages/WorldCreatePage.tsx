import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Alert, Box, Button, ButtonBase, CircularProgress, IconButton, InputAdornment, MenuItem, Stack, SvgIcon, TextField, Typography } from '@mui/material'
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
import ProgressiveImage from '../components/media/ProgressiveImage'
import { QUICK_START_WORLD_STORAGE_KEY } from '../constants/storageKeys'
import { WORLD_GENRE_OPTIONS } from '../constants/worldGenres'
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
  StoryGamePayload,
  StoryGameVisibility,
  StoryWorldCard,
  StoryWorldCardTemplate,
} from '../types/story'
import {
  compressImageDataUrl,
  compressImageFileToDataUrl,
  getJsonDataUrlRequestSafeMaxBytes,
  prepareAvatarPayloadForRequest,
} from '../utils/avatar'
import { resolvePublicationDraftVisibility } from '../utils/publication'
import { PUBLICATION_RULES_SHORT_ITEMS, PUBLICATION_RULES_SHORT_SUMMARY } from '../constants/legalDocuments'

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
type WorldCreateSection = 'main' | 'cards' | 'additional'
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
const PUBLICATION_RULES_ACCEPTED_STORAGE_KEY = 'morius.publication.rules.accepted.v1'
const PLOT_GG_INLINE_TAG_PATTERN = /\[\[\s*GG(?:\s*:\s*([^\]]+?))?\s*\]\]/giu
const CHARACTER_NOTE_MAX_LENGTH = 20
const WORLD_DRAFT_BASE_TITLE = 'Новый мир'
const WORLD_DRAFT_SUFFIX = ' (черновик)'
const WORLD_CREATE_SECTIONS: Array<{ id: WorldCreateSection; label: string }> = [
  { id: 'main', label: 'Основное' },
  { id: 'cards', label: 'Карточки' },
  { id: 'additional', label: 'Дополнительно' },
]
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

function normalizeSaveSignaturePart(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function createPlotCardSignature(values: {
  title: string
  content: string
  triggers?: string | string[] | null
  is_enabled?: boolean | null
}): string {
  const triggers = Array.isArray(values.triggers)
    ? values.triggers
    : parseOptionalTriggers(values.triggers ?? '')
  const normalizedTriggers = triggers.map(normalizeSaveSignaturePart).filter(Boolean).sort().join(',')
  return [
    normalizeSaveSignaturePart(values.title),
    normalizeSaveSignaturePart(values.content),
    normalizedTriggers,
    values.is_enabled ? '1' : '0',
  ].join('::')
}

function createWorldCharacterSignature(
  kind: 'main_hero' | 'npc',
  values: {
    character_id?: number | null
    name?: string | null
    title?: string | null
    description?: string | null
    content?: string | null
    race?: string | null
    clothing?: string | null
    inventory?: string | null
    health_status?: string | null
    triggers?: string | string[] | null
  },
): string {
  if (typeof values.character_id === 'number' && values.character_id > 0) {
    return `${kind}:character:${values.character_id}`
  }
  const triggers = Array.isArray(values.triggers)
    ? values.triggers
    : parseTriggers(values.triggers ?? '', values.name ?? values.title ?? '')
  return [
    kind,
    normalizeSaveSignaturePart(values.name ?? values.title),
    normalizeSaveSignaturePart(values.description ?? values.content),
    normalizeSaveSignaturePart(values.race),
    normalizeSaveSignaturePart(values.clothing),
    normalizeSaveSignaturePart(values.inventory),
    normalizeSaveSignaturePart(values.health_status),
    triggers.map(normalizeSaveSignaturePart).filter(Boolean).sort().join(','),
  ].join('::')
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

function normalizeWorldDraftTitle(value: string): string {
  const normalizedTitle = value.replace(/\s+/g, ' ').trim() || WORLD_DRAFT_BASE_TITLE
  return normalizedTitle.endsWith(WORLD_DRAFT_SUFFIX)
    ? normalizedTitle
    : `${normalizedTitle}${WORLD_DRAFT_SUFFIX}`
}

function normalizeWorldTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || WORLD_DRAFT_BASE_TITLE
}

function renderWorldCreateSectionIcon(sectionId: WorldCreateSection): ReactNode {
  if (sectionId === 'main') {
    return (
      <SvgIcon viewBox="0 0 24 24" sx={{ width: 13, height: 13, flexShrink: 0 }}>
        <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 9h-3.05a15.8 15.8 0 0 0-1.2-5.02A8.03 8.03 0 0 1 18.9 11ZM12 4.05c.77 1.1 1.7 3.02 1.9 6.95h-3.8c.2-3.93 1.13-5.85 1.9-6.95ZM4.1 13h3.05c.16 2 .6 3.73 1.2 5.02A8.03 8.03 0 0 1 4.1 13Zm3.05-2H4.1a8.03 8.03 0 0 1 4.25-5.02A15.8 15.8 0 0 0 7.15 11ZM12 19.95c-.77-1.1-1.7-3.02-1.9-6.95h3.8c-.2 3.93-1.13 5.85-1.9 6.95Zm3.65-1.93c.6-1.29 1.04-3.02 1.2-5.02h3.05a8.03 8.03 0 0 1-4.25 5.02Z" />
      </SvgIcon>
    )
  }
  if (sectionId === 'cards') {
    return (
      <SvgIcon viewBox="0 0 24 24" sx={{ width: 13, height: 13, flexShrink: 0 }}>
        <path fill="currentColor" d="M5 3.5h10.5a2 2 0 0 1 2 2V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Zm1.4 4.2v2h8.2v-2H6.4Zm0 4v1.8h5.5v-1.8H6.4ZM8.5 20.5h11a2 2 0 0 0 2-2v-11h-2v11h-11v2Z" />
      </SvgIcon>
    )
  }
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 13, height: 13, flexShrink: 0 }}>
      <path fill="currentColor" d="M6 4h2.4v2.2H20v2H8.4V10H6V8.2H4v-2h2V4Zm5.6 5h2.4v2.2h6v2h-6V15h-2.4v-1.8H4v-2h7.6V9ZM9 14h2.4v2.2H20v2h-8.6V20H9v-1.8H4v-2h5V14Z" />
    </SvgIcon>
  )
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

function mergePublicationEditPayload(
  sourcePayload: StoryGamePayload,
  publicationPayload: StoryGamePayload,
): StoryGamePayload {
  const publicationWorldProfile = publicationPayload.world_cards.find((card) => card.kind === 'world_profile') ?? null
  const sourceWorldProfile = sourcePayload.world_cards.find((card) => card.kind === 'world_profile') ?? null
  let nextWorldCards = sourcePayload.world_cards

  if (publicationWorldProfile?.avatar_url && sourceWorldProfile && !sourceWorldProfile.avatar_url) {
    nextWorldCards = sourcePayload.world_cards.map((card) =>
      card.id === sourceWorldProfile.id
        ? {
            ...card,
            avatar_url: publicationWorldProfile.avatar_url,
            avatar_original_url: publicationWorldProfile.avatar_original_url ?? publicationWorldProfile.avatar_url,
            avatar_scale: publicationWorldProfile.avatar_scale,
          }
        : card,
    )
  } else if (publicationWorldProfile?.avatar_url && !sourceWorldProfile) {
    nextWorldCards = [
      ...sourcePayload.world_cards,
      {
        ...publicationWorldProfile,
        id: 0,
        game_id: sourcePayload.game.id,
        avatar_original_url: publicationWorldProfile.avatar_original_url ?? publicationWorldProfile.avatar_url,
      },
    ]
  }

  const shouldUsePublicationCover = !sourcePayload.game.cover_image_url && Boolean(publicationPayload.game.cover_image_url)
  return {
    ...sourcePayload,
    game: shouldUsePublicationCover
      ? {
          ...sourcePayload.game,
          cover_image_url: publicationPayload.game.cover_image_url,
          cover_scale: publicationPayload.game.cover_scale,
          cover_position_x: publicationPayload.game.cover_position_x,
          cover_position_y: publicationPayload.game.cover_position_y,
        }
      : sourcePayload.game,
    world_cards: nextWorldCards,
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
  const [isTitleInlineEditing, setIsTitleInlineEditing] = useState(false)
  const [description, setDescription] = useState('')
  const [openingScene, setOpeningScene] = useState('')
  const [openingSceneNpcName, setOpeningSceneNpcName] = useState('')
  const [visibility, setVisibility] = useState<StoryGameVisibility>('private')
  const [activeWorldCreateSection, setActiveWorldCreateSection] = useState<WorldCreateSection>('main')
  const [isOpeningSceneExpanded, setIsOpeningSceneExpanded] = useState(false)
  const [isPublicationRulesDialogOpen, setIsPublicationRulesDialogOpen] = useState(false)
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
  const titleInlineInputRef = useRef<HTMLInputElement | null>(null)
  const openingSceneInputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!isTitleInlineEditing) {
      return
    }
    const timerId = window.setTimeout(() => {
      titleInlineInputRef.current?.focus()
      titleInlineInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timerId)
  }, [isTitleInlineEditing])

  const handleStartTitleInlineEdit = useCallback(() => {
    setTitle((currentTitle) => normalizeWorldTitle(currentTitle))
    setIsTitleInlineEditing(true)
  }, [])

  const handleCommitTitleInlineEdit = useCallback(() => {
    setTitle((currentTitle) => normalizeWorldTitle(currentTitle))
    setIsTitleInlineEditing(false)
  }, [])

  const handleSelectVisibility = useCallback((nextVisibility: StoryGameVisibility) => {
    setVisibility(nextVisibility)
    if (nextVisibility !== 'public') {
      return
    }
    try {
      if (localStorage.getItem(PUBLICATION_RULES_ACCEPTED_STORAGE_KEY) === '1') {
        return
      }
    } catch {
      // If storage is unavailable, still show the rules dialog for the current session.
    }
    setIsPublicationRulesDialogOpen(true)
  }, [])

  const handleAcceptPublicationRules = useCallback(() => {
    try {
      localStorage.setItem(PUBLICATION_RULES_ACCEPTED_STORAGE_KEY, '1')
    } catch {
      // Non-critical: the user can still continue in this session.
    }
    setIsPublicationRulesDialogOpen(false)
  }, [])

  const handleCancelPublicationRules = useCallback(() => {
    setVisibility('private')
    setIsPublicationRulesDialogOpen(false)
  }, [])
  const loadedCommunityCharacterDetailsRef = useRef<Set<number>>(new Set())
  const publishWithoutMainHeroConfirmedRef = useRef(false)
  const isSaveInFlightRef = useRef(false)
  const draftGameIdRef = useRef<number | null>(editingGameId)
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
        if (right.community_rating_count !== left.community_rating_count) {
          return right.community_rating_count - left.community_rating_count
        }
        return Date.parse(right.created_at) - Date.parse(left.created_at) || right.id - left.id
      }
      if (characterPickerSortMode === 'additions_desc') {
        if (right.community_additions_count !== left.community_additions_count) {
          return right.community_additions_count - left.community_additions_count
        }
        return Date.parse(right.created_at) - Date.parse(left.created_at) || right.id - left.id
      }
      const leftTimestamp = Date.parse(left.created_at)
      const rightTimestamp = Date.parse(right.created_at)
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
      draftGameIdRef.current = editingGameId
      setResolvedEditingGameId(editingGameId)
      setIsLoading(false)
      return
    }
    let active = true
    setIsLoading(true)
    draftGameIdRef.current = editingGameId
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
        const sourcePayload = await getStoryGame({ token: authToken, gameId: sourceWorldId })
        return mergePublicationEditPayload(sourcePayload, initialPayload)
      }
      return initialPayload
    }
    void loadEditingPayload()
      .then((payload) => {
        if (!active) return
        draftGameIdRef.current = payload.game.id
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

  const activeCardDialogSource = useMemo(() => {
    if (!cardDialogTargetLocalId) {
      return null
    }
    const source = cardDialogKind === 'instruction' ? instructionCards : plotCards
    return source.find((item) => item.localId === cardDialogTargetLocalId) ?? null
  }, [cardDialogKind, cardDialogTargetLocalId, instructionCards, plotCards])

  const hasCardDialogUnsavedChanges =
    cardTitleDraft !== (activeCardDialogSource?.title ?? '') ||
    cardContentDraft !== (activeCardDialogSource?.content ?? '') ||
    cardTriggersDraft !== (cardDialogKind === 'plot' ? activeCardDialogSource?.triggers ?? '' : '') ||
    cardIsEnabledDraft !== (cardDialogKind === 'plot' ? Boolean(activeCardDialogSource?.is_enabled) : false)

  const activeWorldProfileDialogSource = worldProfileDialogCardId ? worldProfile : null
  const hasWorldProfileDialogUnsavedChanges =
    worldProfileTitleDraft !== (activeWorldProfileDialogSource?.title ?? '') ||
    worldProfileContentDraft !== (activeWorldProfileDialogSource?.content ?? '') ||
    worldProfileAvatarUrlDraft !== (activeWorldProfileDialogSource?.avatar_url ?? null) ||
    worldProfileAvatarOriginalUrlDraft !== (activeWorldProfileDialogSource?.avatar_original_url ?? activeWorldProfileDialogSource?.avatar_url ?? null) ||
    worldProfileAvatarScaleDraft !== (activeWorldProfileDialogSource?.avatar_scale ?? 1)

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
          const preparedMirroredAvatarPayload = await prepareAvatarPayloadForRequest({
            avatarUrl: card.avatar_url,
            avatarOriginalUrl: card.avatar_original_url ?? card.avatar_url,
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
              avatar_url: preparedMirroredAvatarPayload.avatarUrl,
              avatar_original_url: preparedMirroredAvatarPayload.avatarOriginalUrl,
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
                    avatar_original_url:
                      mirroredCharacter.avatar_original_url ?? preparedMirroredAvatarPayload.avatarOriginalUrl,
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
                      avatar_original_url:
                        mirroredCharacter.avatar_original_url ?? preparedMirroredAvatarPayload.avatarOriginalUrl,
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

  const handleSaveWorld = useCallback(async (options?: { saveAsDraft?: boolean; navigateTo?: string }) => {
    const saveAsDraft = Boolean(options?.saveAsDraft)
    if (isSaveInFlightRef.current) return
    if (!saveAsDraft && !canSubmit) return
    if (!saveAsDraft && shouldConfirmPublishWithoutMainHero && !publishWithoutMainHeroConfirmedRef.current) {
      setIsPublishWithoutMainHeroDialogOpen(true)
      return
    }
    publishWithoutMainHeroConfirmedRef.current = false
    if (!saveAsDraft && !isMyGamesEdit && hasTemplateConflicts(mainHero, npcs)) {
      setErrorMessage('Удалите дубли персонажей: ГГ и NPC не могут ссылаться на одного персонажа, а NPC не должны повторяться.')
      return
    }
    isSaveInFlightRef.current = true
    setIsSubmitting(true)
    setIsPublishWithoutMainHeroDialogOpen(false)
    setErrorMessage('')
    try {
      let gameId = draftGameIdRef.current ?? resolvedEditingGameId
      const normalizedTitle = saveAsDraft ? normalizeWorldDraftTitle(title) : title.trim()
      const normalizedDescription = description.trim()
      const normalizedOpeningScene = openingScene.replace(/\r\n/g, '\n').trim()
      const preparedCoverImageUrl = coverImageUrl?.startsWith('data:image/')
        ? await compressImageDataUrl(coverImageUrl, {
            maxBytes: getJsonDataUrlRequestSafeMaxBytes(COVER_MAX_BYTES),
            maxDimension: 1800,
          })
        : coverImageUrl
      const prepareCharacterAvatarPayloadForRequest = async (
        card: Pick<EditableCharacterCard, 'avatar_url' | 'avatar_original_url'>,
      ): Promise<{ avatarUrl: string | null; avatarOriginalUrl: string | null }> => {
        return prepareAvatarPayloadForRequest({
          avatarUrl: card.avatar_url,
          avatarOriginalUrl: card.avatar_original_url ?? card.avatar_url,
          maxBytes: CHARACTER_AVATAR_MAX_BYTES,
          maxDimension: 1200,
        })
      }
      const prepareWorldBannerPayloadForRequest = async (
        card: Pick<EditableWorldProfileCard, 'avatar_url' | 'avatar_original_url'>,
      ): Promise<{ avatarUrl: string | null; avatarOriginalUrl: string | null }> => {
        return prepareAvatarPayloadForRequest({
          avatarUrl: card.avatar_url,
          avatarOriginalUrl: card.avatar_original_url ?? card.avatar_url,
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
        const preparedCharacterAvatarPayload = await prepareCharacterAvatarPayloadForRequest(card)
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
            avatar_url: preparedCharacterAvatarPayload.avatarUrl,
            avatar_original_url: preparedCharacterAvatarPayload.avatarOriginalUrl,
            avatar_scale: clamp(card.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
            emotion_assets: card.emotion_assets ?? {},
            emotion_model: card.emotion_model ?? null,
            emotion_prompt_lock: card.emotion_prompt_lock ?? null,
            visibility: 'private',
          },
        })
        setCharacters((previous) => [...previous.filter((item) => item.id !== createdCharacter.id), createdCharacter])
        const resolvedCard = {
          ...card,
          character_id: createdCharacter.id,
          source_character_id: createdCharacter.source_character_id ?? card.source_character_id,
          race: normalizeCharacterRace(createdCharacter.race || card.race),
          clothing: normalizeCharacterAdditionalField(createdCharacter.clothing || card.clothing),
          inventory: normalizeCharacterAdditionalField(createdCharacter.inventory || card.inventory),
          health_status: normalizeCharacterAdditionalField(createdCharacter.health_status || card.health_status),
          avatar_url: createdCharacter.avatar_url ?? card.avatar_url,
          avatar_original_url: createdCharacter.avatar_original_url ?? preparedCharacterAvatarPayload.avatarOriginalUrl,
          avatar_scale: clamp(createdCharacter.avatar_scale ?? card.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
          emotion_assets: createdCharacter.emotion_assets ?? card.emotion_assets,
          emotion_model: createdCharacter.emotion_model ?? card.emotion_model,
          emotion_prompt_lock: createdCharacter.emotion_prompt_lock ?? card.emotion_prompt_lock,
        }
        setMainHero((previous) => (previous?.localId === card.localId ? resolvedCard : previous))
        setNpcs((previous) => previous.map((item) => (item.localId === card.localId ? resolvedCard : item)))
        return resolvedCard
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
        draftGameIdRef.current = created.id
        setResolvedEditingGameId(created.id)
      }
      const latest = await getStoryGame({ token: authToken, gameId })
      const existingInstructionById = new Map(latest.instruction_cards.map((card) => [card.id, card]))
      const existingInstructionBySignature = new Map(
        latest.instruction_cards.map((card) => [createInstructionTemplateSignature(card.title, card.content), card]),
      )
      const savedInstructionIds = new Set<number>()
      for (const card of instructionCards) {
        const existingCard =
          (card.id ? existingInstructionById.get(card.id) : undefined) ??
          existingInstructionBySignature.get(createInstructionTemplateSignature(card.title, card.content))
        if (existingCard) {
          const updatedCard = await updateStoryInstructionCard({
            token: authToken,
            gameId,
            instructionId: existingCard.id,
            title: card.title,
            content: card.content,
          })
          savedInstructionIds.add(updatedCard.id)
          if (card.id !== updatedCard.id) {
            setInstructionCards((previous) =>
              previous.map((item) => (item.localId === card.localId ? { ...item, id: updatedCard.id } : item)),
            )
          }
        } else {
          const createdCard = await createStoryInstructionCard({ token: authToken, gameId, title: card.title, content: card.content })
          savedInstructionIds.add(createdCard.id)
          setInstructionCards((previous) =>
            previous.map((item) => (item.localId === card.localId ? { ...item, id: createdCard.id } : item)),
          )
        }
      }
      for (const card of latest.instruction_cards) {
        if (!savedInstructionIds.has(card.id)) {
          await deleteStoryInstructionCard({ token: authToken, gameId, instructionId: card.id })
        }
      }
      const existingPlotById = new Map(latest.plot_cards.map((card) => [card.id, card]))
      const existingPlotBySignature = new Map(
        latest.plot_cards.map((card) => [createPlotCardSignature(card), card]),
      )
      const savedPlotIds = new Set<number>()
      for (const card of plotCards) {
        const desiredEnabled = Boolean(card.is_enabled)
        const normalizedTriggers = parseOptionalTriggers(card.triggers ?? '')
        const existingCard =
          (card.id ? existingPlotById.get(card.id) : undefined) ??
          existingPlotBySignature.get(createPlotCardSignature(card))
        if (existingCard) {
          const updatedCard = await updateStoryPlotCard({
            token: authToken,
            gameId,
            cardId: existingCard.id,
            title: card.title,
            content: card.content,
            triggers: normalizedTriggers,
            is_enabled: desiredEnabled,
          })
          savedPlotIds.add(updatedCard.id)
          if (card.id !== updatedCard.id) {
            setPlotCards((previous) =>
              previous.map((item) => (item.localId === card.localId ? { ...item, id: updatedCard.id } : item)),
            )
          }
        } else {
          const createdCard = await createStoryPlotCard({
            token: authToken,
            gameId,
            title: card.title,
            content: card.content,
            triggers: normalizedTriggers,
            is_enabled: desiredEnabled,
          })
          savedPlotIds.add(createdCard.id)
          setPlotCards((previous) =>
            previous.map((item) => (item.localId === card.localId ? { ...item, id: createdCard.id } : item)),
          )
        }
      }
      for (const card of latest.plot_cards) {
        if (!savedPlotIds.has(card.id)) {
          await deleteStoryPlotCard({ token: authToken, gameId, cardId: card.id })
        }
      }
      const existingWorldProfile = latest.world_cards.find((card) => card.kind === 'world_profile') ?? null
      if (worldProfile) {
        const preparedWorldProfileBannerPayload = await prepareWorldBannerPayloadForRequest(worldProfile)
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
            avatar_url: preparedWorldProfileBannerPayload.avatarUrl,
            avatar_original_url: preparedWorldProfileBannerPayload.avatarOriginalUrl,
            avatar_scale: worldProfile.avatar_scale,
          })
          if (worldProfile.id !== worldProfileTargetId) {
            setWorldProfile((previous) => (previous ? { ...previous, id: worldProfileTargetId } : previous))
          }
        } else {
          const createdWorldProfile = await createStoryWorldCard({
            token: authToken,
            gameId,
            kind: 'world_profile',
            title: worldProfile.title,
            content: worldProfile.content,
            triggers: parseTriggers('', worldProfile.title),
            avatar_url: preparedWorldProfileBannerPayload.avatarUrl,
            avatar_original_url: preparedWorldProfileBannerPayload.avatarOriginalUrl,
            avatar_scale: worldProfile.avatar_scale,
            memory_turns: null,
          })
          setWorldProfile((previous) => (previous ? { ...previous, id: createdWorldProfile.id } : previous))
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
          const preparedMainHeroAvatarPayload = await prepareCharacterAvatarPayloadForRequest(resolvedMainHero)
          if (existingMainHero) {
            const updatedMainHero = await updateStoryWorldCard({
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
              avatar_url: preparedMainHeroAvatarPayload.avatarUrl,
              avatar_original_url: preparedMainHeroAvatarPayload.avatarOriginalUrl,
              avatar_scale: resolvedMainHero.avatar_scale,
            })
            setMainHero((previous) =>
              previous?.localId === resolvedMainHero.localId ? { ...previous, id: updatedMainHero.id } : previous,
            )
          } else {
            const createdMainHero = await createStoryWorldCard({
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
              avatar_url: preparedMainHeroAvatarPayload.avatarUrl,
              avatar_original_url: preparedMainHeroAvatarPayload.avatarOriginalUrl,
              avatar_scale: resolvedMainHero.avatar_scale,
              character_id: resolvedMainHero.character_id ?? null,
            })
            setMainHero((previous) =>
              previous?.localId === resolvedMainHero.localId ? { ...previous, id: createdMainHero.id } : previous,
            )
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
      const savedNpcIds = new Set<number>()
      const findExistingNpcForDraft = (npc: EditableCharacterCard): StoryWorldCard | null => {
        if (npc.id) {
          const existingById = existingNpcs.find((item) => item.id === npc.id)
          if (existingById && !savedNpcIds.has(existingById.id)) {
            return existingById
          }
        }
        const signature = createWorldCharacterSignature('npc', npc)
        return (
          existingNpcs.find(
            (item) => !savedNpcIds.has(item.id) && createWorldCharacterSignature('npc', item) === signature,
          ) ?? null
        )
      }
      for (const npc of resolvedNpcs) {
        const preparedNpcAvatarPayload = await prepareCharacterAvatarPayloadForRequest(npc)
        const existingNpc = findExistingNpcForDraft(npc)
        if (existingNpc) {
          const updatedNpc = await updateStoryWorldCard({
            token: authToken,
            gameId,
            cardId: existingNpc.id,
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
            cardId: existingNpc.id,
            avatar_url: preparedNpcAvatarPayload.avatarUrl,
            avatar_original_url: preparedNpcAvatarPayload.avatarOriginalUrl,
            avatar_scale: npc.avatar_scale,
          })
          savedNpcIds.add(updatedNpc.id)
          setNpcs((previous) =>
            previous.map((item) => (item.localId === npc.localId ? { ...item, id: updatedNpc.id } : item)),
          )
        } else {
          const createdNpc = await createStoryWorldCard({
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
            avatar_url: preparedNpcAvatarPayload.avatarUrl,
            avatar_original_url: preparedNpcAvatarPayload.avatarOriginalUrl,
            avatar_scale: npc.avatar_scale,
            character_id: npc.character_id ?? null,
          })
          savedNpcIds.add(createdNpc.id)
          setNpcs((previous) =>
            previous.map((item) => (item.localId === npc.localId ? { ...item, id: createdNpc.id } : item)),
          )
        }
      }
      for (const npc of existingNpcs) {
        if (!savedNpcIds.has(npc.id)) {
          await deleteStoryWorldCard({ token: authToken, gameId, cardId: npc.id })
        }
      }
      await updateStoryGameMeta({
        token: authToken,
        gameId,
        title: normalizedTitle,
        description: normalizedDescription,
        opening_scene: normalizedOpeningScene,
        visibility: saveAsDraft ? 'private' : visibility,
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
      onNavigate(options?.navigateTo ?? (isMyPublicationsEdit ? '/games/publications' : `/home/${gameId}`))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось сохранить мир')
    } finally {
      isSaveInFlightRef.current = false
      setIsSubmitting(false)
    }
  }, [ageRating, authToken, canSubmit, coverImageUrl, coverPositionX, coverPositionY, coverScale, description, genres, hasTemplateConflicts, instructionCards, isMyGamesEdit, isMyPublicationsEdit, mainHero, npcs, onNavigate, openingScene, persistTitleForGame, plotCards, resolvedEditingGameId, shouldConfirmPublishWithoutMainHero, title, user.id, visibility, worldProfile])

  const handleCancelWorld = useCallback(() => {
    if (isEditMode) {
      onNavigate(isMyPublicationsEdit ? '/games/publications' : '/games')
      return
    }
    void handleSaveWorld({ saveAsDraft: true, navigateTo: '/games' })
  }, [handleSaveWorld, isEditMode, isMyPublicationsEdit, onNavigate])

  const handleNavigateFromWorldCreate = useCallback(
    (path: string) => {
      if (isEditMode || path === '/worlds/new') {
        onNavigate(path)
        return
      }
      void handleSaveWorld({ saveAsDraft: true, navigateTo: path })
    },
    [handleSaveWorld, isEditMode, onNavigate],
  )

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
    handleNavigateFromWorldCreate('/shop')
  }, [handleNavigateFromWorldCreate])

  const loadTopUpPlans = useCallback(async () => {
    setIsTopUpPlansLoading(true)
    setTopUpError('')
    try {
      const plans = await getCoinTopUpPlans()
      setTopUpPlans(plans)
      setHasTopUpPlansLoaded(true)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить пакеты валюты'
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
          onContinue: () => handleNavigateFromWorldCreate('/dashboard?mobileAction=continue'),
          onQuickStart: () => handleNavigateFromWorldCreate('/dashboard?mobileAction=quick-start'),
          onCreateWorld: () => handleNavigateFromWorldCreate('/worlds/new'),
          onOpenShop: handleOpenTopUpDialog,
        })}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: false, onClick: () => handleNavigateFromWorldCreate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', isActive: false, onClick: () => handleNavigateFromWorldCreate('/games') },
          { key: 'games-publications', label: 'Мои публикации', isActive: false, onClick: () => handleNavigateFromWorldCreate('/games/publications') },
          {
            key: isEditMode ? 'community-worlds' : 'world-create',
            label: isEditMode ? '\u0421\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e' : '\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u043c\u0438\u0440\u0430',
            isActive: !isEditMode,
            onClick: () => handleNavigateFromWorldCreate(isEditMode ? '/games/all' : '/worlds/new'),
          },
        ]}
        pageMenuLabels={{ expanded: 'Свернуть меню', collapsed: 'Открыть меню' }}
        isRightPanelOpen={isHeaderActionsOpen}
        onToggleRightPanel={() => setIsHeaderActionsOpen((p) => !p)}
        rightToggleLabels={{ expanded: 'Скрыть действия', collapsed: 'Показать действия' }}
        showAiAssistantAction={user.ai_assistant_visible ?? true}
        onOpenTopUpDialog={handleOpenTopUpDialog}
        rightActions={
          <HeaderAccountActions
            user={user}
            authToken={authToken}
            avatarSize={HEADER_AVATAR_SIZE}
            onOpenProfile={() => handleNavigateFromWorldCreate('/profile')}
          />
        }
      />
      <Box sx={{ pt: '86px', px: { xs: 2, md: 3 }, pb: { xs: 'calc(88px + env(safe-area-inset-bottom))', md: 4 } }}>
        <Stack spacing={3.2} sx={{ maxWidth: 1160, mx: 'auto' }}>
          {errorMessage ? <Alert severity="error" onClose={() => setErrorMessage('')} sx={{ mb: 1.4, borderRadius: '12px' }}>{errorMessage}</Alert> : null}
          <Box
            sx={{
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              background: APP_CARD_BACKGROUND,
              px: { xs: 1.3, md: 1.8 },
              py: { xs: 1.2, md: 1.4 },
            }}
          >
            <Stack spacing={1.35}>
              <Stack direction="row" spacing={0.85} alignItems="center">
                <Box component="span" sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.1rem', lineHeight: 1 }}>
                  ✎
                </Box>
                {isTitleInlineEditing ? (
                  <Box
                    component="input"
                    ref={titleInlineInputRef}
                    value={title}
                    maxLength={140}
                    onChange={(event) => setTitle(event.target.value)}
                    onBlur={handleCommitTitleInlineEdit}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleCommitTitleInlineEdit()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setIsTitleInlineEditing(false)
                      }
                    }}
                    aria-label="Название мира"
                    sx={{
                      width: 'min(100%, 420px)',
                      minWidth: 0,
                      border: 'none',
                      borderBottom: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 72%, transparent)',
                      outline: 'none',
                      backgroundColor: 'transparent',
                      color: APP_TEXT_PRIMARY,
                      font: 'inherit',
                      fontSize: '1.35rem',
                      fontWeight: 850,
                      lineHeight: 1.15,
                      px: 0,
                      py: 0.15,
                    }}
                  />
                ) : (
                  <ButtonBase
                    onClick={handleStartTitleInlineEdit}
                    sx={{
                      minWidth: 0,
                      borderRadius: '8px',
                      px: 0.15,
                      py: 0.1,
                      textAlign: 'left',
                      '&:focus-visible': { outline: '2px solid rgba(205, 223, 246, 0.56)', outlineOffset: '2px' },
                    }}
                    aria-label="Редактировать название мира"
                  >
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.35rem', fontWeight: 850, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {title.trim() || (isEditMode ? 'Редактирование мира' : WORLD_DRAFT_BASE_TITLE)}
                    </Typography>
                  </ButtonBase>
                )}
              </Stack>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.1} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between">
                <Stack direction="row" spacing={0.7} sx={{ flexWrap: 'wrap', gap: 0.7 }}>
                  {WORLD_CREATE_SECTIONS.map((section) => {
                    const isActive = activeWorldCreateSection === section.id
                    return (
                      <Box
                        key={section.id}
                        component="button"
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => setActiveWorldCreateSection(section.id)}
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          height: 38,
                          px: '16px',
                          borderRadius: '48px',
                          border: 'none',
                          outline: 'none',
                          backgroundColor: 'var(--morius-elevated-bg)',
                          color: isActive ? 'var(--morius-title-text)' : APP_TEXT_SECONDARY,
                          font: 'inherit',
                          fontSize: { xs: '0.82rem', sm: '0.9rem' },
                          fontWeight: 700,
                          lineHeight: 1,
                          cursor: 'pointer',
                          userSelect: 'none',
                          boxShadow: isActive ? '0 0 24px color-mix(in srgb, var(--morius-accent) 50%, transparent)' : 'none',
                          transition: 'box-shadow 250ms ease, color 200ms ease',
                          '&:hover': {
                            color: 'var(--morius-title-text)',
                          },
                          '&:focus-visible': { outline: '2px solid rgba(205, 223, 246, 0.56)', outlineOffset: '2px' },
                        }}
                      >
                        {renderWorldCreateSectionIcon(section.id)}
                        {section.label}
                      </Box>
                    )
                  })}
                </Stack>
                <Stack direction="row" spacing={0.9} justifyContent={{ xs: 'flex-end', md: 'flex-start' }}>
                  <Button onClick={handleCancelWorld} disabled={isSubmitting} sx={{ minHeight: 38, color: APP_TEXT_SECONDARY }}>
                    Отмена
                  </Button>
                  <Button
                    data-tour-id="world-create-submit"
                    onClick={() => void handleSaveWorld()}
                    disabled={!canSubmit}
                    sx={{
                      minHeight: 42,
                      px: 1.75,
                      borderRadius: '12px',
                      color: APP_TEXT_PRIMARY,
                      backgroundColor: canSubmit ? 'var(--morius-accent)' : 'color-mix(in srgb, var(--morius-elevated-bg) 88%, #7d8795)',
                      boxShadow: canSubmit ? '0 10px 24px color-mix(in srgb, var(--morius-accent) 28%, transparent)' : 'none',
                      '&:hover': {
                        backgroundColor: canSubmit ? 'color-mix(in srgb, var(--morius-accent) 86%, #ffffff 14%)' : 'color-mix(in srgb, var(--morius-elevated-bg) 88%, #7d8795)',
                      },
                      '&:disabled': {
                        color: 'color-mix(in srgb, var(--morius-text-primary) 62%, transparent)',
                        backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, #7d8795)',
                      },
                    }}
                  >
                    {isSubmitting ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : isEditMode ? 'Сохранить' : 'Создать'}
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          </Box>

          {isLoading ? <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress /></Stack> : <Stack spacing={2.2}>
            <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: { xs: '2rem', md: '2.55rem' }, fontWeight: 900, lineHeight: 1.08 }}>
              {WORLD_CREATE_SECTIONS.find((section) => section.id === activeWorldCreateSection)?.label}
            </Typography>
            {activeWorldCreateSection === 'additional' ? (
            <Stack data-tour-id="world-create-cover" spacing={0.95} sx={{ scrollMarginTop: '120px' }}>
              <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>Баннер</Typography>
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
                      height: { xs: 188, sm: 230, md: 292 },
                      maxHeight: { md: 292 },
                      position: 'relative',
                      background: coverImageUrl
                        ? 'transparent'
                        : 'linear-gradient(110deg, color-mix(in srgb, var(--morius-card-bg) 86%, #111925) 0%, color-mix(in srgb, var(--morius-elevated-bg) 74%, #404a5a) 100%)',
                    }}
                  >
                    {coverImageUrl ? (
                      <ProgressiveImage
                        src={coverImageUrl}
                        alt=""
                        loading="lazy"
                        loaderSize={28}
                        objectFit="cover"
                        containerSx={{
                          position: 'absolute',
                          inset: 0,
                          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 88%, #000 12%)',
                        }}
                        imgSx={{
                          position: 'absolute',
                          left: `${coverPositionX}%`,
                          top: `${coverPositionY}%`,
                          width: `${Math.max(100, coverScale * 100)}%`,
                          height: `${Math.max(100, coverScale * 100)}%`,
                          minWidth: '100%',
                          minHeight: '100%',
                          maxWidth: 'none',
                          maxHeight: 'none',
                          transform: 'translate(-50%, -50%)',
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
                          width: { xs: 54, sm: 62 },
                          height: { xs: 54, sm: 62 },
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
                          <Typography component="span" sx={{ fontSize: { xs: '1.8rem', sm: '2rem' }, lineHeight: 1 }}>
                            +
                          </Typography>
                        )}
                      </Box>
                      <Typography
                        sx={{
                          mt: 1,
                          px: 1.4,
                          py: 0.65,
                          borderRadius: '999px',
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 78%, transparent)',
                          color: APP_TEXT_PRIMARY,
                          fontSize: '0.9rem',
                          fontWeight: 800,
                        }}
                      >
                        {coverImageUrl ? 'Изменить баннер' : 'Загрузить баннер'}
                      </Typography>
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
            ) : null}

            {activeWorldCreateSection === 'additional' ? (
              <Stack data-tour-id="world-create-opening-scene" spacing={0.75} sx={{ scrollMarginTop: '120px' }}>
                <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>Вступительная сцена</Typography>
                <Button
                  onClick={() => setIsOpeningSceneExpanded((previous) => !previous)}
                  sx={{
                    minHeight: 46,
                    justifyContent: 'space-between',
                    borderRadius: '14px',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_CARD_BACKGROUND,
                    color: APP_TEXT_PRIMARY,
                    textTransform: 'none',
                    px: 1.2,
                    '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                  }}
                >
                  <Stack spacing={0.25} sx={{ textAlign: 'left', minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 850, lineHeight: 1.15 }}>Вступительная сцена</Typography>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem', lineHeight: 1.25 }}>
                      Необязательный текст до первого хода игрока; если заполнить, он учитывается сразу в первом ответе рассказчика.
                    </Typography>
                  </Stack>
                  <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1.2rem', lineHeight: 1 }}>
                    {isOpeningSceneExpanded ? '-' : '+'}
                  </Typography>
                </Button>
                {isOpeningSceneExpanded ? (
                  <>
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
                          <Button size="small" onClick={() => insertOpeningSceneTag('gg_name')} sx={OPENING_SCENE_TAG_BUTTON_SX}>
                            ГГ
                          </Button>
                          <Button size="small" onClick={() => insertOpeningSceneTag('gg_speech')} sx={OPENING_SCENE_TAG_BUTTON_SX}>
                            GG реплика
                          </Button>
                          <Button size="small" onClick={() => insertOpeningSceneTag('gg_thought')} sx={OPENING_SCENE_TAG_BUTTON_SX}>
                            GG мысли
                          </Button>
                          <Button size="small" onClick={() => insertOpeningSceneTag('npc_speech')} sx={OPENING_SCENE_TAG_BUTTON_SX}>
                            NPC реплика
                          </Button>
                          <Button size="small" onClick={() => insertOpeningSceneTag('npc_thought')} sx={OPENING_SCENE_TAG_BUTTON_SX}>
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
                  </>
                ) : null}
              </Stack>
            ) : null}

            {activeWorldCreateSection === 'main' ? (
              <>
            <Stack data-tour-id="world-create-visibility-top" spacing={0.9} sx={{ scrollMarginTop: '120px' }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={0.8}>
                <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>Параметры доступа</Typography>
                {visibility === 'public' ? (
                  <Button
                    onClick={() => handleNavigateFromWorldCreate('/publication-rules')}
                    sx={{ minHeight: 34, borderRadius: '10px', textTransform: 'none', color: 'var(--morius-accent)' }}
                  >
                    Правила публикаций
                  </Button>
                ) : null}
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                <Button
                  onClick={() => handleSelectVisibility('private')}
                  sx={{
                    minHeight: 48,
                    flex: 1,
                    borderRadius: '14px',
                    border: visibility === 'private' ? 'var(--morius-border-width) solid var(--morius-accent)' : `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: visibility === 'private' ? 'color-mix(in srgb, var(--morius-accent) 14%, var(--morius-card-bg))' : APP_CARD_BACKGROUND,
                    color: visibility === 'private' ? APP_TEXT_PRIMARY : APP_TEXT_SECONDARY,
                    fontWeight: 850,
                    textTransform: 'none',
                    '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                  }}
                >
                  Частный
                </Button>
                <Button
                  onClick={() => handleSelectVisibility('public')}
                  sx={{
                    minHeight: 48,
                    flex: 1,
                    borderRadius: '14px',
                    border: visibility === 'public' ? 'var(--morius-border-width) solid var(--morius-accent)' : `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: visibility === 'public' ? 'color-mix(in srgb, var(--morius-accent) 14%, var(--morius-card-bg))' : APP_CARD_BACKGROUND,
                    color: visibility === 'public' ? APP_TEXT_PRIMARY : APP_TEXT_SECONDARY,
                    fontWeight: 850,
                    textTransform: 'none',
                    '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                  }}
                >
                  Публичный
                </Button>
              </Stack>
              {visibility === 'public' ? (
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem', lineHeight: 1.45 }}>
                  Публичный мир станет отдельной публикацией без истории прохождения.
                </Typography>
              ) : null}
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
            </Stack>
              </>
            ) : null}

            {activeWorldCreateSection === 'additional' ? (
            <Stack data-tour-id="world-create-genres" spacing={1} sx={{ scrollMarginTop: '120px' }}>
              <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>Теги</Typography>
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
            ) : null}

            {activeWorldCreateSection === 'cards' ? (
            <Box data-tour-id="world-create-cards" sx={{ scrollMarginTop: '120px', display: 'flex', flexDirection: 'column', gap: 2.2 }}>
              <Stack spacing={0.85} sx={{ order: 4 }}>
                <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>Правила</Typography>
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
                <EmptyAddCard
                  onClick={() => openCardDialog('instruction')}
                  label="Добавить карточку правил"
                  actions={[
                    { label: 'Новая', onClick: () => openCardDialog('instruction') },
                    { label: 'Из шаблона', onClick: () => setInstructionTemplateDialogOpen(true) },
                  ]}
                />
              </Stack>

              <Stack spacing={0.85} sx={{ order: 2 }}>
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

              <Stack spacing={0.9} sx={{ order: 3 }}>
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

              <Stack spacing={0.9} sx={{ order: 1 }}>
                <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>Персонажи</Typography>
                <Stack spacing={0.7}>
                  <Typography sx={{ color: APP_TEXT_SECONDARY, fontWeight: 700, fontSize: '0.95rem' }}>Главный герой</Typography>
                  <Button
                    onClick={() => setCharacterPickerTarget('main_hero')}
                    sx={{
                      width: '100%',
                      minHeight: 74,
                      justifyContent: 'space-between',
                      borderRadius: '14px',
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: APP_CARD_BACKGROUND,
                      color: APP_TEXT_PRIMARY,
                      textTransform: 'none',
                      px: 1.1,
                      '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                    }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, textAlign: 'left' }}>
                      {mainHero ? (
                        <MiniAvatar avatarUrl={mainHero.avatar_url} avatarScale={mainHero.avatar_scale} label={mainHero.name} size={44} />
                      ) : (
                        <Box
                          sx={{
                            width: 44,
                            height: 44,
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 90%, #ffffff 10%)',
                            color: APP_TEXT_SECONDARY,
                            fontSize: '1.45rem',
                            fontWeight: 900,
                            flexShrink: 0,
                          }}
                        >
                          ?
                        </Box>
                      )}
                      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                        <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 850, fontSize: '1rem', lineHeight: 1.18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {mainHero?.name || 'Главный герой'}
                        </Typography>
                        <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {mainHero ? 'Выбран главный герой' : 'Выберите главного героя'}
                        </Typography>
                      </Stack>
                    </Stack>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1.25rem', lineHeight: 1 }}>⌄</Typography>
                  </Button>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7}>
                    <Button onClick={() => openCharacterManagerForCreate('main_hero')} sx={{ minHeight: 34, flex: 1 }}>
                      Новая
                    </Button>
                    <Button onClick={() => setCharacterPickerTarget('main_hero')} sx={{ minHeight: 34, flex: 1 }}>
                      Из шаблона
                    </Button>
                    {mainHero ? (
                      <Button onClick={() => setMainHero(null)} sx={{ minHeight: 34, flex: 1, color: APP_TEXT_SECONDARY }}>
                        Убрать
                      </Button>
                    ) : null}
                    {mainHero ? (
                      <Button
                        onClick={() => void openCharacterManagerForEdit('main_hero', mainHero)}
                        disabled={isOpeningCharacterManager}
                        sx={{ minHeight: 34, flex: 1 }}
                      >
                        Изменить
                      </Button>
                    ) : null}
                  </Stack>
                </Stack>

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
                  <EmptyAddCard
                    onClick={() => openCharacterManagerForCreate('npc')}
                    label="Добавить NPC"
                    actions={[
                      { label: 'Новая', onClick: () => openCharacterManagerForCreate('npc') },
                      { label: 'Из шаблона', onClick: () => setCharacterPickerTarget('npc') },
                    ]}
                  />
                </Stack>
              </Stack>
            </Box>
            ) : null}
          </Stack>}
        </Stack>
      </Box>

      <BaseDialog
        open={isPublicationRulesDialogOpen}
        onClose={handleCancelPublicationRules}
        maxWidth="sm"
        paperSx={dialogPaperSx}
        showCloseButton={false}
        disableBackdropClose
        header={
          <Stack spacing={0.5}>
            <Typography sx={{ fontWeight: 850, fontSize: '1.35rem' }}>Правила публикаций</Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.92rem', lineHeight: 1.45 }}>
              {PUBLICATION_RULES_SHORT_SUMMARY}
            </Typography>
          </Stack>
        }
        actions={
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} justifyContent="flex-end" sx={{ width: '100%' }}>
            <Button onClick={handleCancelPublicationRules} sx={{ color: APP_TEXT_SECONDARY, textTransform: 'none' }}>
              Отмена
            </Button>
            <Button
              onClick={handleAcceptPublicationRules}
              sx={{
                minHeight: 40,
                px: 1.4,
                borderRadius: '12px',
                color: APP_TEXT_PRIMARY,
                textTransform: 'none',
                backgroundColor: APP_BUTTON_ACTIVE,
                '&:hover': { backgroundColor: APP_BUTTON_HOVER },
              }}
            >
              Принимаю
            </Button>
          </Stack>
        }
      >
        <Stack spacing={0.8}>
          {PUBLICATION_RULES_SHORT_ITEMS.map((item) => (
            <Typography key={item} sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.94rem', lineHeight: 1.45 }}>
              • {item}
            </Typography>
          ))}
        </Stack>
      </BaseDialog>

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
        title={cardDialogKind === 'instruction' ? 'Карточка правил' : 'Карточка сюжета'}
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
        hasUnsavedChanges={hasCardDialogUnsavedChanges}
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
        hasUnsavedChanges={hasWorldProfileDialogUnsavedChanges}
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
        authToken={authToken}
        onClose={handleCloseTopUpDialog}
        onPurchasePlan={handlePurchaseTopUpPlan}
      />
    </Box>
  )
}

export default WorldCreatePage
