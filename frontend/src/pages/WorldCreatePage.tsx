import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import BaseDialog from '../components/dialogs/BaseDialog'
import FormDialog from '../components/dialogs/FormDialog'
import UserAvatar from '../components/profile/UserAvatar'
import ImageCropper from '../components/ImageCropper'
import TextLimitIndicator from '../components/TextLimitIndicator'
import { QUICK_START_WORLD_STORAGE_KEY } from '../constants/storageKeys'
import {
  createStoryGame,
  createStoryInstructionCard,
  createStoryPlotCard,
  createStoryWorldCard,
  deleteStoryInstructionCard,
  deleteStoryPlotCard,
  deleteStoryWorldCard,
  getStoryGame,
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
import type { StoryCharacter, StoryGameVisibility, StoryWorldCard } from '../types/story'
import { compressImageDataUrl, compressImageFileToDataUrl } from '../utils/avatar'

type WorldCreatePageProps = {
  user: AuthUser
  authToken: string
  editingGameId?: number | null
  onNavigate: (path: string) => void
}

type EditableCard = {
  localId: string
  id?: number
  title: string
  content: string
}

type EditableCharacterCard = {
  localId: string
  id?: number
  character_id: number | null
  name: string
  description: string
  triggers: string
  avatar_url: string | null
  avatar_scale: number
}

const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const APP_BUTTON_ACTIVE = 'var(--morius-button-active)'
const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const AVATAR_SCALE_MIN = 1
const AVATAR_SCALE_MAX = 3
const COVER_MAX_BYTES = 360 * 1024
const CHARACTER_AVATAR_MAX_BYTES = 260 * 1024
const CARD_WIDTH = 286
const AGE_RATING_OPTIONS = ['6+', '16+', '18+'] as const
const MAX_WORLD_GENRES = 3
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
  background: APP_CARD_BACKGROUND,
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

function createInstructionTemplateSignature(title: string, content: string): string {
  const normalizedTitle = title.replace(/\s+/g, ' ').trim().toLowerCase()
  const normalizedContent = content.replace(/\s+/g, ' ').trim().toLowerCase()
  return `${normalizedTitle}::${normalizedContent}`
}

function normalizeCharacterIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^0-9a-zа-яё\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildDefaultCoverDataUrl(): string {
  if (typeof document === 'undefined') {
    return ''
  }

  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const context = canvas.getContext('2d')
  if (!context) {
    return ''
  }

  const seed = Math.floor(Math.random() * 1_000_000)
  const waveOffset = 18 + (seed % 9)
  const glowX = 0.4 + ((seed % 31) / 100)
  const glowY = 0.08 + ((seed % 17) / 220)

  const baseGradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
  baseGradient.addColorStop(0, '#0f141b')
  baseGradient.addColorStop(0.55, '#121926')
  baseGradient.addColorStop(1, '#0f1012')
  context.fillStyle = baseGradient
  context.fillRect(0, 0, canvas.width, canvas.height)

  const ambientGlow = context.createRadialGradient(
    canvas.width * glowX,
    canvas.height * glowY,
    0,
    canvas.width * glowX,
    canvas.height * glowY,
    canvas.width * 0.85,
  )
  ambientGlow.addColorStop(0, 'rgba(78, 110, 145, 0.38)')
  ambientGlow.addColorStop(0.48, 'rgba(46, 70, 101, 0.24)')
  ambientGlow.addColorStop(1, 'rgba(17, 17, 17, 0)')
  context.fillStyle = ambientGlow
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.strokeStyle = 'rgba(150, 182, 219, 0.14)'
  context.lineWidth = 2
  for (let index = 0; index < 34; index += 1) {
    context.beginPath()
    context.arc(-canvas.width * 0.08, canvas.height * 0.26, 120 + index * waveOffset, 0, Math.PI * 2)
    context.stroke()
  }

  context.fillStyle = 'rgba(17, 17, 17, 0.44)'
  context.fillRect(0, canvas.height * 0.7, canvas.width, canvas.height * 0.3)

  return canvas.toDataURL('image/jpeg', 0.9)
}

function toEditableCharacterFromTemplate(character: StoryCharacter): EditableCharacterCard {
  return {
    localId: makeLocalId(),
    character_id: character.id,
    name: character.name,
    description: character.description,
    triggers: character.triggers.join(', '),
    avatar_url: character.avatar_url,
    avatar_scale: clamp(character.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
  }
}

function toEditableCharacterFromWorldCard(card: StoryWorldCard): EditableCharacterCard {
  return {
    localId: makeLocalId(),
    id: card.id,
    character_id: card.character_id ?? null,
    name: card.title,
    description: card.content,
    triggers: card.triggers.join(', '),
    avatar_url: card.avatar_url,
    avatar_scale: clamp(card.avatar_scale ?? 1, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
  }
}

function MiniAvatar({ avatarUrl, avatarScale, label, size = 52 }: { avatarUrl: string | null; avatarScale: number; label: string; size?: number }) {
  if (!avatarUrl) {
    return (
      <Box sx={{ width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center', color: APP_TEXT_PRIMARY, fontWeight: 800, flexShrink: 0 }}>
        {label.trim().charAt(0).toUpperCase() || '•'}
      </Box>
    )
  }
  return (
    <Box sx={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
      <Box component="img" src={avatarUrl} alt={label} sx={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${clamp(avatarScale, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX)})`, transformOrigin: 'center center' }} />
    </Box>
  )
}

function CompactCard({ title, content, badge, avatar, actions }: { title: string; content: string; badge?: string; avatar?: ReactNode; actions?: ReactNode }) {
  return (
    <Box sx={{ width: { xs: '100%', sm: CARD_WIDTH }, minHeight: 186, borderRadius: 'var(--morius-radius)', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, background: 'var(--morius-elevated-bg)', boxShadow: '0 12px 28px rgba(0, 0, 0, 0.24)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 1.1, py: 0.85, borderBottom: 'var(--morius-border-width) solid var(--morius-card-border)', background: 'var(--morius-card-bg)' }}>
        <Stack direction="row" spacing={0.7} alignItems="center">
          {avatar}
          <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 800, fontSize: '1rem', lineHeight: 1.2, minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</Typography>
          {badge ? <Typography sx={{ color: 'rgba(170, 238, 191, 0.96)', fontSize: '0.63rem', lineHeight: 1, letterSpacing: 0.22, textTransform: 'uppercase', fontWeight: 700, border: 'var(--morius-border-width) solid rgba(128, 213, 162, 0.46)', borderRadius: '999px', px: 0.58, py: 0.18 }}>{badge}</Typography> : null}
        </Stack>
      </Box>
      <Box sx={{ px: 1.1, py: 0.9, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Typography sx={{ color: 'rgba(208, 219, 235, 0.88)', fontSize: '0.86rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{content}</Typography>
        {actions ? <Stack direction="row" spacing={0.7} sx={{ mt: 'auto', pt: 0.9 }}>{actions}</Stack> : null}
      </Box>
    </Box>
  )
}

function WorldCreatePage({ user, authToken, editingGameId = null, onNavigate }: WorldCreatePageProps) {
  const isEditMode = editingGameId !== null
  const [isPageMenuOpen, setIsPageMenuOpen] = usePersistentPageMenuState()
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
  const [isLoading, setIsLoading] = useState(Boolean(isEditMode))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [openingScene, setOpeningScene] = useState('')
  const [visibility, setVisibility] = useState<StoryGameVisibility>('private')
  const [ageRating, setAgeRating] = useState<StoryAgeRating>('16+')
  const [genres, setGenres] = useState<string[]>([])
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null)
  const [coverScale, setCoverScale] = useState(1)
  const [coverPositionX, setCoverPositionX] = useState(50)
  const [coverPositionY, setCoverPositionY] = useState(50)
  const [coverCropSource, setCoverCropSource] = useState<string | null>(null)

  const [instructionCards, setInstructionCards] = useState<EditableCard[]>([])
  const [plotCards, setPlotCards] = useState<EditableCard[]>([])
  const [mainHero, setMainHero] = useState<EditableCharacterCard | null>(null)
  const [npcs, setNpcs] = useState<EditableCharacterCard[]>([])
  const [characters, setCharacters] = useState<StoryCharacter[]>([])

  const [cardDialogOpen, setCardDialogOpen] = useState(false)
  const [cardDialogKind, setCardDialogKind] = useState<'instruction' | 'plot'>('instruction')
  const [cardDialogTargetLocalId, setCardDialogTargetLocalId] = useState<string | null>(null)
  const [cardTitleDraft, setCardTitleDraft] = useState('')
  const [cardContentDraft, setCardContentDraft] = useState('')
  const [instructionTemplateDialogOpen, setInstructionTemplateDialogOpen] = useState(false)

  const [characterPickerTarget, setCharacterPickerTarget] = useState<'main_hero' | 'npc' | null>(null)
  const [characterDialogOpen, setCharacterDialogOpen] = useState(false)
  const [characterDialogTarget, setCharacterDialogTarget] = useState<'main_hero' | 'npc'>('npc')
  const [characterDialogTargetLocalId, setCharacterDialogTargetLocalId] = useState<string | null>(null)
  const [characterNameDraft, setCharacterNameDraft] = useState('')
  const [characterDescriptionDraft, setCharacterDescriptionDraft] = useState('')
  const [characterTriggersDraft, setCharacterTriggersDraft] = useState('')
  const [characterAvatarDraft, setCharacterAvatarDraft] = useState<string | null>(null)
  const [characterAvatarScaleDraft, setCharacterAvatarScaleDraft] = useState(1)
  const [characterAvatarCropSource, setCharacterAvatarCropSource] = useState<string | null>(null)

  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const characterAvatarInputRef = useRef<HTMLInputElement | null>(null)
  const hasInitializedDefaultCoverRef = useRef(false)
  const sortedCharacters = useMemo(() => [...characters].sort((a, b) => a.name.localeCompare(b.name, 'ru-RU')), [characters])
  const selectedInstructionTemplateSignatures = useMemo(
    () => instructionCards.map((card) => createInstructionTemplateSignature(card.title, card.content)),
    [instructionCards],
  )
  const openingSceneTagCharacters = useMemo(() => sortedCharacters.slice(0, 8), [sortedCharacters])
  const mainHeroName = useMemo(() => normalizeCharacterIdentity(mainHero?.name ?? ''), [mainHero?.name])
  const npcCharacterIds = useMemo(() => new Set(npcs.map((npc) => npc.character_id).filter((id): id is number => Boolean(id))), [npcs])
  const npcNames = useMemo(() => {
    const names = new Set<string>()
    npcs.forEach((npc) => {
      const normalizedName = normalizeCharacterIdentity(npc.name)
      if (normalizedName) {
        names.add(normalizedName)
      }
    })
    return names
  }, [npcs])
  const canSubmit = useMemo(
    () => !isSubmitting && !isLoading && Boolean(title.trim()),
    [isLoading, isSubmitting, title],
  )

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

  const appendOpeningSceneTemplate = useCallback((template: string) => {
    setOpeningScene((previousValue) => {
      const trimmed = previousValue.trimEnd()
      if (!trimmed) {
        return template
      }
      return `${trimmed}\n${template}`
    })
  }, [])

  useEffect(() => {
    if (isEditMode || hasInitializedDefaultCoverRef.current) {
      return
    }
    hasInitializedDefaultCoverRef.current = true
    const generatedCover = buildDefaultCoverDataUrl()
    if (!generatedCover) {
      return
    }
    setCoverImageUrl(generatedCover)
    setCoverScale(1)
    setCoverPositionX(50)
    setCoverPositionY(50)
  }, [isEditMode])

  const getTemplateDisabledReason = useCallback(
    (character: StoryCharacter, target: 'main_hero' | 'npc'): string | null => {
      const normalizedName = normalizeCharacterIdentity(character.name)
      if (target === 'main_hero') {
        return npcCharacterIds.has(character.id) || (normalizedName && npcNames.has(normalizedName))
          ? 'Уже выбран как NPC'
          : null
      }
      if ((mainHero?.character_id === character.id) || (mainHeroName && normalizedName && mainHeroName === normalizedName)) {
        return 'Уже выбран как главный герой'
      }
      return npcCharacterIds.has(character.id) || (normalizedName && npcNames.has(normalizedName))
        ? 'Уже выбран как NPC'
        : null
    },
    [mainHero?.character_id, mainHeroName, npcCharacterIds, npcNames],
  )

  const hasTemplateConflicts = useCallback((hero: EditableCharacterCard | null, nextNpcs: EditableCharacterCard[]) => {
    const usedNpcTemplates = new Set<number>()
    for (const npc of nextNpcs) {
      if (!npc.character_id) continue
      if (hero?.character_id && npc.character_id === hero.character_id) return true
      if (usedNpcTemplates.has(npc.character_id)) return true
      usedNpcTemplates.add(npc.character_id)
    }
    return false
  }, [])

  useEffect(() => {
    let active = true
    listStoryCharacters(authToken).then((items) => active && setCharacters(items)).catch(() => active && setCharacters([]))
    return () => { active = false }
  }, [authToken])

  useEffect(() => {
    if (!isEditMode || editingGameId === null) {
      setIsLoading(false)
      return
    }
    let active = true
    setIsLoading(true)
    getStoryGame({ token: authToken, gameId: editingGameId })
      .then((payload) => {
        if (!active) return
        setTitle(payload.game.title)
        setDescription(payload.game.description)
        setOpeningScene(payload.game.opening_scene ?? '')
        setVisibility(payload.game.visibility)
        setAgeRating(payload.game.age_rating)
        setGenres(payload.game.genres.slice(0, MAX_WORLD_GENRES))
        setCoverImageUrl(payload.game.cover_image_url)
        setCoverScale(payload.game.cover_scale ?? 1)
        setCoverPositionX(payload.game.cover_position_x ?? 50)
        setCoverPositionY(payload.game.cover_position_y ?? 50)
        setInstructionCards(payload.instruction_cards.map((card) => ({ localId: makeLocalId(), id: card.id, title: card.title, content: card.content })))
        setPlotCards(payload.plot_cards.map((card) => ({ localId: makeLocalId(), id: card.id, title: card.title, content: card.content })))
        const hero = payload.world_cards.find((card) => card.kind === 'main_hero') ?? null
        setMainHero(hero ? toEditableCharacterFromWorldCard(hero) : null)
        setNpcs(payload.world_cards.filter((card) => card.kind === 'npc').map(toEditableCharacterFromWorldCard))
      })
      .catch((error) => active && setErrorMessage(error instanceof Error ? error.message : 'Не удалось загрузить мир'))
      .finally(() => active && setIsLoading(false))
    return () => { active = false }
  }, [authToken, editingGameId, isEditMode])

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
        maxBytes: COVER_MAX_BYTES,
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

  const openCardDialog = useCallback((kind: 'instruction' | 'plot', card?: EditableCard) => {
    setCardDialogKind(kind)
    setCardDialogTargetLocalId(card?.localId ?? null)
    setCardTitleDraft(card?.title ?? '')
    setCardContentDraft(card?.content ?? '')
    setCardDialogOpen(true)
  }, [])

  const saveCardDialog = useCallback(() => {
    const next: EditableCard = { localId: cardDialogTargetLocalId ?? makeLocalId(), title: cardTitleDraft.trim(), content: cardContentDraft.trim() }
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
  }, [cardContentDraft, cardDialogKind, cardDialogTargetLocalId, cardTitleDraft])

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

  const openCharacterDialog = useCallback((target: 'main_hero' | 'npc', card?: EditableCharacterCard) => {
    setCharacterDialogTarget(target)
    setCharacterDialogTargetLocalId(card?.localId ?? null)
    setCharacterNameDraft(card?.name ?? '')
    setCharacterDescriptionDraft(card?.description ?? '')
    setCharacterTriggersDraft(card?.triggers ?? '')
    setCharacterAvatarDraft(card?.avatar_url ?? null)
    setCharacterAvatarScaleDraft(card?.avatar_scale ?? 1)
    setCharacterDialogOpen(true)
  }, [])

  const handleCharacterAvatarUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }
    try {
      const dataUrl = await compressImageFileToDataUrl(file, { maxBytes: CHARACTER_AVATAR_MAX_BYTES, maxDimension: 1200 })
      setCharacterAvatarCropSource(dataUrl)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось загрузить аватар')
    }
  }, [])

  const openCharacterAvatarCrop = useCallback(() => {
    if (!characterAvatarDraft) {
      return
    }
    setCharacterAvatarCropSource(characterAvatarDraft)
  }, [characterAvatarDraft])

  const handleCancelCharacterAvatarCrop = useCallback(() => {
    setCharacterAvatarCropSource(null)
  }, [])

  const handleSaveCharacterAvatarCrop = useCallback(async (croppedDataUrl: string) => {
    try {
      const preparedAvatar = await compressImageDataUrl(croppedDataUrl, {
        maxBytes: CHARACTER_AVATAR_MAX_BYTES,
        maxDimension: 1200,
      })
      setCharacterAvatarDraft(preparedAvatar)
      setCharacterAvatarScaleDraft(1)
      setCharacterAvatarCropSource(null)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось подготовить аватар')
    }
  }, [])

  const saveCharacterDialog = useCallback(() => {
    const next: EditableCharacterCard = {
      localId: characterDialogTargetLocalId ?? makeLocalId(),
      character_id: null,
      name: characterNameDraft.trim(),
      description: characterDescriptionDraft.trim(),
      triggers: characterTriggersDraft,
      avatar_url: characterAvatarDraft,
      avatar_scale: clamp(characterAvatarScaleDraft, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX),
    }
    if (!next.name || !next.description) return
    if (characterDialogTarget === 'main_hero') {
      setMainHero((prev) => (prev ? { ...next, id: prev.id, character_id: prev.character_id } : next))
    } else {
      setNpcs((prev) => {
        const idx = prev.findIndex((item) => item.localId === next.localId)
        if (idx < 0) return [...prev, next]
        const copy = [...prev]
        copy[idx] = { ...copy[idx], ...next, id: copy[idx].id }
        return copy
      })
    }
    setCharacterDialogOpen(false)
  }, [characterAvatarDraft, characterAvatarScaleDraft, characterDescriptionDraft, characterDialogTarget, characterDialogTargetLocalId, characterNameDraft, characterTriggersDraft])

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

  const handleSaveWorld = useCallback(async () => {
    if (!canSubmit) return
    if (hasTemplateConflicts(mainHero, npcs)) {
      setErrorMessage('Удалите дубли персонажей: ГГ и NPC не могут ссылаться на одного персонажа, а NPC не должны повторяться.')
      return
    }
    setIsSubmitting(true)
    setErrorMessage('')
    try {
      let gameId = editingGameId
      const normalizedTitle = title.trim()
      const normalizedDescription = description.trim()
      const normalizedOpeningScene = openingScene.replace(/\r\n/g, '\n').trim()
      const preparedCoverImageUrl = coverImageUrl?.startsWith('data:image/')
        ? await compressImageDataUrl(coverImageUrl, {
            maxBytes: COVER_MAX_BYTES,
            maxDimension: 1800,
          })
        : coverImageUrl
      const prepareAvatarForRequest = async (avatarUrl: string | null): Promise<string | null> => {
        if (!avatarUrl || !avatarUrl.startsWith('data:image/')) {
          return avatarUrl
        }
        return compressImageDataUrl(avatarUrl, {
          maxBytes: CHARACTER_AVATAR_MAX_BYTES,
          maxDimension: 1200,
        })
      }
      if (gameId === null) {
        const created = await createStoryGame({
          token: authToken,
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
        gameId = created.id
      } else {
        await updateStoryGameMeta({
          token: authToken,
          gameId,
          title: normalizedTitle,
          description: normalizedDescription,
          visibility,
          age_rating: ageRating,
          genres,
          cover_image_url: preparedCoverImageUrl,
          cover_scale: coverScale,
          cover_position_x: coverPositionX,
          cover_position_y: coverPositionY,
        })
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
        if (card.id && existingPlotById.has(card.id)) await updateStoryPlotCard({ token: authToken, gameId, cardId: card.id, title: card.title, content: card.content })
        else await createStoryPlotCard({ token: authToken, gameId, title: card.title, content: card.content })
      }
      for (const card of latest.plot_cards) if (!plotCards.some((item) => item.id === card.id)) await deleteStoryPlotCard({ token: authToken, gameId, cardId: card.id })
      const existingMainHero = latest.world_cards.find((card) => card.kind === 'main_hero') ?? null
      if (mainHero) {
        const preparedMainHeroAvatarUrl = await prepareAvatarForRequest(mainHero.avatar_url)
        if (existingMainHero) {
          await updateStoryWorldCard({ token: authToken, gameId, cardId: existingMainHero.id, title: mainHero.name, content: mainHero.description, triggers: parseTriggers(mainHero.triggers, mainHero.name) })
          await updateStoryWorldCardAvatar({ token: authToken, gameId, cardId: existingMainHero.id, avatar_url: preparedMainHeroAvatarUrl, avatar_scale: mainHero.avatar_scale })
        } else {
          await createStoryWorldCard({ token: authToken, gameId, kind: 'main_hero', title: mainHero.name, content: mainHero.description, triggers: parseTriggers(mainHero.triggers, mainHero.name), avatar_url: preparedMainHeroAvatarUrl, avatar_scale: mainHero.avatar_scale })
        }
      } else if (existingMainHero) {
        await deleteStoryWorldCard({ token: authToken, gameId, cardId: existingMainHero.id })
      }
      const existingNpcs = latest.world_cards.filter((card) => card.kind === 'npc')
      for (const npc of npcs) {
        const preparedNpcAvatarUrl = await prepareAvatarForRequest(npc.avatar_url)
        if (npc.id && existingNpcs.some((item) => item.id === npc.id)) {
          await updateStoryWorldCard({ token: authToken, gameId, cardId: npc.id, title: npc.name, content: npc.description, triggers: parseTriggers(npc.triggers, npc.name) })
          await updateStoryWorldCardAvatar({ token: authToken, gameId, cardId: npc.id, avatar_url: preparedNpcAvatarUrl, avatar_scale: npc.avatar_scale })
        } else {
          await createStoryWorldCard({ token: authToken, gameId, kind: 'npc', title: npc.name, content: npc.description, triggers: parseTriggers(npc.triggers, npc.name), avatar_url: preparedNpcAvatarUrl, avatar_scale: npc.avatar_scale })
        }
      }
      for (const npc of existingNpcs) if (!npcs.some((item) => item.id === npc.id)) await deleteStoryWorldCard({ token: authToken, gameId, cardId: npc.id })
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
      onNavigate(`/home/${gameId}`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось сохранить мир')
    } finally {
      setIsSubmitting(false)
    }
  }, [ageRating, authToken, canSubmit, coverImageUrl, coverPositionX, coverPositionY, coverScale, description, editingGameId, genres, hasTemplateConflicts, instructionCards, mainHero, npcs, onNavigate, openingScene, persistTitleForGame, plotCards, title, visibility])

  const helpEmpty = (text: string) => (
    <Box sx={{ borderRadius: '12px', border: `var(--morius-border-width) dashed rgba(170, 188, 214, 0.34)`, background: 'var(--morius-elevated-bg)', p: 1.1 }}><Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>{text}</Typography></Box>
  )

  const heroTitle = title.trim() ? title.trim() : isEditMode ? 'Редактирование мира' : 'Создание мира'

  return (
    <Box sx={{ minHeight: '100svh', color: APP_TEXT_PRIMARY, background: APP_PAGE_BACKGROUND }}>
      <AppHeader
        isPageMenuOpen={isPageMenuOpen}
        onTogglePageMenu={() => setIsPageMenuOpen((p) => !p)}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: false, onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', isActive: false, onClick: () => onNavigate('/games') },
          { key: 'world-create', label: isEditMode ? 'Редактирование мира' : 'Создание мира', isActive: true, onClick: () => onNavigate('/worlds/new') },
        ]}
        pageMenuLabels={{ expanded: 'Свернуть меню', collapsed: 'Открыть меню' }}
        isRightPanelOpen={isHeaderActionsOpen}
        onToggleRightPanel={() => setIsHeaderActionsOpen((p) => !p)}
        rightToggleLabels={{ expanded: 'Скрыть действия', collapsed: 'Показать действия' }}
        onOpenTopUpDialog={() => onNavigate('/profile')}
        rightActions={
          <Button onClick={() => onNavigate('/profile')} sx={{ minWidth: 0, width: HEADER_AVATAR_SIZE, height: HEADER_AVATAR_SIZE, p: 0, borderRadius: '50%' }}>
            <UserAvatar user={user} size={HEADER_AVATAR_SIZE} />
          </Button>
        }
      />
      <Box sx={{ pt: '86px', px: { xs: 2, md: 3 }, pb: 4 }}>
        <Box sx={{ maxWidth: 1160, mx: 'auto', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, borderRadius: 'var(--morius-radius)', background: APP_CARD_BACKGROUND, p: { xs: 1.4, md: 1.8 } }}>
          {errorMessage ? <Alert severity="error" onClose={() => setErrorMessage('')} sx={{ mb: 1.4, borderRadius: '12px' }}>{errorMessage}</Alert> : null}
          {isLoading ? <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress /></Stack> : <Stack spacing={1.5}>
            <Stack spacing={0.35}><Typography sx={{ fontSize: { xs: '1.65rem', md: '1.9rem' }, fontWeight: 800 }}>{heroTitle}</Typography><Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.95rem' }}>Заполните мир и добавьте карточки. После создания он сразу откроется в игре.</Typography></Stack>
            <TextField
              label="Название мира"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
              inputProps={{ maxLength: 140 }}
              helperText={<TextLimitIndicator currentLength={title.length} maxLength={140} />}
              FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
            />
            <TextField
              label="Краткое описание"
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
            {!isEditMode ? <>
            <TextField
              label="Вступительная сцена"
              value={openingScene}
              onChange={(e) => setOpeningScene(e.target.value)}
              fullWidth
              multiline
              minRows={3}
              maxRows={8}
              inputProps={{ maxLength: 4000 }}
              helperText={<TextLimitIndicator currentLength={openingScene.length} maxLength={4000} />}
              FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
            />
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
              Разметка для вступления: {'\n'}
              {'<narrative>Ночь была неспокойной...</narrative>'}{'\n'}
              {'<gg-replick:Алекс>Ты в порядке?</gg-replick>'}{'\n'}
              {'<npc-replick:Стражник>Стой. Назовись.</npc-replick>'}{'\n'}
              {'<gg-thought:Алекс>Лучше не спорить...</gg-thought>'}{'\n'}
              {'<npc-thought:Стражник>Он что-то скрывает.</npc-thought>'}{'\n\n'}
              Чтобы взять имя и аватар из «Мои персонажи», используйте @Имя:{'\n'}
              {'<gg-replick:@Алекс Уейт>...</gg-replick>'}{'\n'}
              {'<npc-replick:@Аками Наито>...</npc-replick>'}
            </Typography>
            {openingSceneTagCharacters.length > 0 ? (
              <Stack spacing={0.55}>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}>Быстрые теги из «Мои персонажи»:</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.55 }}>
                  {openingSceneTagCharacters.map((character) => (
                    <Button
                      key={`opening-scene-character-${character.id}`}
                      onClick={() => appendOpeningSceneTemplate(`<npc-replick:@${character.name}>...</npc-replick>`)}
                      sx={{
                        minHeight: 30,
                        px: 0.95,
                        borderRadius: '999px',
                        textTransform: 'none',
                        border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                        backgroundColor: APP_CARD_BACKGROUND,
                        color: APP_TEXT_PRIMARY,
                        fontSize: '0.82rem',
                      }}
                    >
                      {character.name}
                    </Button>
                  ))}
                </Box>
              </Stack>
            ) : null}
            </> : null}
            <Stack spacing={0.75}>
              <Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>Возрастное ограничение</Typography>
              <Stack direction="row" spacing={0.8} flexWrap="wrap">
                {AGE_RATING_OPTIONS.map((option) => (
                  <Button
                    key={option}
                    onClick={() => setAgeRating(option)}
                    sx={{
                      minHeight: 38,
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: ageRating === option ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                      color: APP_TEXT_PRIMARY,
                    }}
                  >
                    {option}
                  </Button>
                ))}
              </Stack>
            </Stack>
            <Stack spacing={0.75}>
              <Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>Жанры (до 3)</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.7 }}>
                {WORLD_GENRE_OPTIONS.map((genre) => {
                  const isSelected = genres.includes(genre)
                  const isLimitReached = !isSelected && genres.length >= MAX_WORLD_GENRES
                  return (
                    <Button
                      key={genre}
                      onClick={() => toggleGenre(genre)}
                      disabled={isLimitReached}
                      sx={{
                        minHeight: 34,
                        px: 1.1,
                        borderRadius: '999px',
                        textTransform: 'none',
                        border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                        backgroundColor: isSelected ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                        color: APP_TEXT_PRIMARY,
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
            <Divider />
            <Stack spacing={0.95}>
              <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" flexWrap="wrap"><Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>Обложка мира</Typography><Stack direction="row" spacing={0.8}><Button onClick={() => coverInputRef.current?.click()} sx={{ minHeight: 36 }}>{coverImageUrl ? 'Изменить' : 'Загрузить'}</Button><Button onClick={openCoverCropEditor} disabled={!coverImageUrl} sx={{ minHeight: 36 }}>Настроить кадр</Button><Button onClick={() => setCoverImageUrl(null)} disabled={!coverImageUrl} sx={{ minHeight: 36, color: APP_TEXT_SECONDARY }}>Удалить</Button></Stack></Stack>
              <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleCoverUpload} style={{ display: 'none' }} />
              <Box sx={{ minHeight: 208, borderRadius: 'var(--morius-radius)', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, backgroundImage: coverImageUrl ? `url(${coverImageUrl})` : 'none', backgroundColor: coverImageUrl ? 'transparent' : 'var(--morius-elevated-bg)', backgroundSize: coverImageUrl ? `${coverScale * 100}%` : 'cover', backgroundPosition: `${coverPositionX}% ${coverPositionY}%` }} />
              <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem' }}>Лимит файла: 360 KB. Изображение автоматически сжимается перед сохранением.</Typography>
            </Stack>
            <Divider />
            <Stack spacing={0.75}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>Карточки инструкций</Typography><Stack direction="row" spacing={0.8}><Button onClick={() => openCardDialog('instruction')} sx={{ minHeight: 36 }}>Добавить</Button><Button onClick={() => setInstructionTemplateDialogOpen(true)} sx={{ minHeight: 36 }}>Из шаблона</Button></Stack></Stack>{instructionCards.length === 0 ? helpEmpty('Добавьте первую инструкцию. Например: стиль повествования, ограничения или тон диалогов.') : <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{instructionCards.map((card) => <CompactCard key={card.localId} title={card.title} content={card.content} badge="активна" actions={<><Button onClick={() => openCardDialog('instruction', card)} sx={{ minHeight: 30, px: 1.05 }}>Изменить</Button><Button onClick={() => setInstructionCards((p) => p.filter((i) => i.localId !== card.localId))} sx={{ minHeight: 30, px: 1.05, color: APP_TEXT_SECONDARY }}>Удалить</Button></>} />)}</Box>}</Stack>
            <Divider />
            <Stack spacing={0.75}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>Карточки сюжета</Typography><Button onClick={() => openCardDialog('plot')} sx={{ minHeight: 36 }}>Добавить</Button></Stack>{plotCards.length === 0 ? helpEmpty('Сюжетные карточки помогут быстро держать контекст истории и ключевые события.') : <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{plotCards.map((card) => <CompactCard key={card.localId} title={card.title} content={card.content} badge="активна" actions={<><Button onClick={() => openCardDialog('plot', card)} sx={{ minHeight: 30, px: 1.05 }}>Изменить</Button><Button onClick={() => setPlotCards((p) => p.filter((i) => i.localId !== card.localId))} sx={{ minHeight: 30, px: 1.05, color: APP_TEXT_SECONDARY }}>Удалить</Button></>} />)}</Box>}</Stack>
            <Divider />
            <Stack spacing={0.75}><Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap"><Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>Главный герой (необязательно)</Typography><Stack direction="row" spacing={0.8}><Button onClick={() => setCharacterPickerTarget('main_hero')} sx={{ minHeight: 36 }}>Из «Мои персонажи»</Button><Button onClick={() => openCharacterDialog('main_hero', mainHero ?? undefined)} sx={{ minHeight: 36 }}>{mainHero ? 'Редактировать вручную' : 'Создать вручную'}</Button></Stack></Stack>{mainHero ? <CompactCard title={mainHero.name} content={`${mainHero.description}${mainHero.triggers.trim() ? `\nТриггеры: ${mainHero.triggers.trim()}` : ''}`} badge="гг" avatar={<MiniAvatar avatarUrl={mainHero.avatar_url} avatarScale={mainHero.avatar_scale} label={mainHero.name} size={38} />} actions={<><Button onClick={() => openCharacterDialog('main_hero', mainHero)} sx={{ minHeight: 30, px: 1.05 }}>Изменить</Button><Button onClick={() => setMainHero(null)} sx={{ minHeight: 30, px: 1.05, color: APP_TEXT_SECONDARY }}>Убрать</Button></>} /> : helpEmpty('Главного героя можно добавить позже. Для сохранения мира достаточно названия.')}</Stack>
            <Divider />
            <Stack spacing={0.75}><Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap"><Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>NPC</Typography><Stack direction="row" spacing={0.8}><Button onClick={() => setCharacterPickerTarget('npc')} sx={{ minHeight: 36 }}>Из «Мои персонажи»</Button><Button onClick={() => openCharacterDialog('npc')} sx={{ minHeight: 36 }}>Добавить вручную</Button></Stack></Stack>{npcs.length === 0 ? helpEmpty('Пока NPC не добавлены. Можно начать игру без NPC и добавить их позже.') : <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{npcs.map((npc) => <CompactCard key={npc.localId} title={npc.name} content={`${npc.description}${npc.triggers.trim() ? `\nТриггеры: ${npc.triggers.trim()}` : ''}`} badge="npc" avatar={<MiniAvatar avatarUrl={npc.avatar_url} avatarScale={npc.avatar_scale} label={npc.name} size={38} />} actions={<><Button onClick={() => openCharacterDialog('npc', npc)} sx={{ minHeight: 30, px: 1.05 }}>Изменить</Button><Button onClick={() => setNpcs((p) => p.filter((i) => i.localId !== npc.localId))} sx={{ minHeight: 30, px: 1.05, color: APP_TEXT_SECONDARY }}>Удалить</Button></>} />)}</Box>}</Stack>
            <Divider />
            <Stack spacing={0.75}><Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>Видимость мира</Typography><Stack direction="row" spacing={0.8}><Button onClick={() => setVisibility('private')} sx={{ minHeight: 38, border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, backgroundColor: visibility === 'private' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND }}>Приватный</Button><Button onClick={() => setVisibility('public')} sx={{ minHeight: 38, border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, backgroundColor: visibility === 'public' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND }}>Публичный</Button></Stack></Stack>
            <Stack direction="row" spacing={0.8} justifyContent="flex-end"><Button onClick={() => onNavigate('/games')} sx={{ minHeight: 38, color: APP_TEXT_SECONDARY }}>Отмена</Button><Button onClick={() => void handleSaveWorld()} disabled={!canSubmit} sx={{ minHeight: 38, border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, color: APP_TEXT_PRIMARY, backgroundColor: APP_BUTTON_ACTIVE, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>{isSubmitting ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : isEditMode ? 'Сохранить' : 'Создать'}</Button></Stack>
          </Stack>}
        </Box>
      </Box>

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
            {!cardTitleDraft.trim() || !cardContentDraft.trim() ? <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.83rem' }}>Введите заголовок и текст карточки, чтобы кнопка сохранения стала доступна.</Typography> : null}
          </Stack>
        
      </FormDialog>

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

          <Button onClick={() => setCharacterPickerTarget(null)} sx={{ color: APP_TEXT_SECONDARY }}>Закрыть</Button>
        
        }
      >

          <Stack spacing={0.8}>
            {sortedCharacters.length === 0 ? helpEmpty('У вас пока нет сохранённых персонажей. Сначала добавьте их в разделе «Мои персонажи».') : sortedCharacters.map((character) => {
              const disabledReason = characterPickerTarget ? getTemplateDisabledReason(character, characterPickerTarget) : null
              return (
                <Box key={character.id} sx={{ borderRadius: '12px', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, background: 'var(--morius-elevated-bg)', px: 0.85, py: 0.75 }}>
                  <Button onClick={() => applyTemplate(character)} disabled={Boolean(disabledReason)} sx={{ width: '100%', p: 0, textTransform: 'none', justifyContent: 'flex-start', border: 'none', '&:hover': { background: 'transparent' } }}>
                    <Stack direction="row" spacing={0.8} alignItems="center" sx={{ width: '100%', textAlign: 'left' }}>
                      <MiniAvatar avatarUrl={character.avatar_url} avatarScale={character.avatar_scale} label={character.name} size={42} />
                      <Stack sx={{ minWidth: 0, flex: 1 }}>
                        <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 800, fontSize: '0.98rem', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{character.name}</Typography>
                        <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{character.description}</Typography>
                      </Stack>
                    </Stack>
                  </Button>
                  {disabledReason ? <Typography sx={{ color: 'rgba(240, 176, 176, 0.92)', fontSize: '0.76rem', mt: 0.55 }}>{disabledReason}</Typography> : null}
                </Box>
              )
            })}
          </Stack>
        
      </BaseDialog>

      <FormDialog
        open={characterDialogOpen}
        onClose={() => setCharacterDialogOpen(false)}
        onSubmit={saveCharacterDialog}
        title={characterDialogTarget === 'main_hero' ? 'Главный герой' : 'NPC'}
        description="Если не загрузить изображение, будет использована заглушка."
        maxWidth="sm"
        paperSx={dialogPaperSx}
        titleSx={{ pb: 0.8 }}
        contentSx={{ pt: 0.35 }}
        actionsSx={{ px: 3, pb: 2.2 }}
        cancelButtonSx={{ color: APP_TEXT_SECONDARY }}
        submitButtonSx={{
          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
          backgroundColor: APP_BUTTON_ACTIVE,
          '&:hover': { backgroundColor: APP_BUTTON_HOVER },
        }}
        submitDisabled={!characterNameDraft.trim() || !characterDescriptionDraft.trim()}
      >

          <Stack spacing={1}>
            <Box
              sx={{
                borderRadius: '12px',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                backgroundColor: 'var(--morius-card-bg)',
                px: 1.1,
                py: 1.1,
              }}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box
                    role="button"
                    tabIndex={0}
                    aria-label="Изменить аватар персонажа"
                    onClick={() => characterAvatarInputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        characterAvatarInputRef.current?.click()
                      }
                    }}
                    sx={{
                      position: 'relative',
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      outline: 'none',
                      '&:hover .world-character-avatar-overlay': {
                        opacity: 1,
                      },
                      '&:focus-visible .world-character-avatar-overlay': {
                        opacity: 1,
                      },
                    }}
                  >
                    <MiniAvatar
                      avatarUrl={characterAvatarDraft}
                      avatarScale={characterAvatarScaleDraft}
                      label={characterNameDraft || 'Персонаж'}
                      size={64}
                    />
                    <Box
                      className="world-character-avatar-overlay"
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(23, 23, 22, 0.72)',
                        opacity: 0,
                        transition: 'opacity 180ms ease',
                      }}
                    >
                      <Box
                        sx={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          border: 'var(--morius-border-width) solid rgba(219, 221, 231, 0.5)',
                          backgroundColor: 'var(--morius-elevated-bg)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--morius-text-primary)',
                          fontSize: '1.02rem',
                          fontWeight: 700,
                        }}
                      >
                        {'\u270E'}
                      </Box>
                    </Box>
                  </Box>
                  <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.82rem' }}>
                    Нажмите на аватар, чтобы заменить изображение
                  </Typography>
                </Stack>

                <Box>
                  <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.82rem' }}>
                    Масштаб аватара: {characterAvatarScaleDraft.toFixed(2)}x
                  </Typography>
                  <Slider
                    min={AVATAR_SCALE_MIN}
                    max={AVATAR_SCALE_MAX}
                    step={0.05}
                    value={characterAvatarScaleDraft}
                    onChange={(_, value) => setCharacterAvatarScaleDraft(value as number)}
                  />
                </Box>

                <input
                  ref={characterAvatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleCharacterAvatarUpload}
                  style={{ display: 'none' }}
                />

                <Stack direction="row" spacing={0.8}>
                  <Button onClick={openCharacterAvatarCrop} disabled={!characterAvatarDraft} sx={{ minHeight: 34 }}>
                    Настроить кадр
                  </Button>
                  <Button onClick={() => setCharacterAvatarDraft(null)} sx={{ minHeight: 34, color: APP_TEXT_SECONDARY }}>
                    Удалить аватар
                  </Button>
                </Stack>

                <TextField
                  label="Имя"
                  value={characterNameDraft}
                  onChange={(e) => setCharacterNameDraft(e.target.value)}
                  fullWidth
                  inputProps={{ maxLength: 140 }}
                  helperText={<TextLimitIndicator currentLength={characterNameDraft.length} maxLength={140} />}
                  FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                />
                <TextField
                  label="Описание"
                  value={characterDescriptionDraft}
                  onChange={(e) => setCharacterDescriptionDraft(e.target.value)}
                  fullWidth
                  multiline
                  minRows={4}
                  maxRows={8}
                  inputProps={{ maxLength: 6000 }}
                  helperText={<TextLimitIndicator currentLength={characterDescriptionDraft.length} maxLength={6000} />}
                  FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                />
                <TextField
                  label="Триггеры"
                  value={characterTriggersDraft}
                  onChange={(e) => setCharacterTriggersDraft(e.target.value)}
                  fullWidth
                  multiline
                  minRows={2}
                  maxRows={5}
                  placeholder="через запятую"
                  inputProps={{ maxLength: 600 }}
                  helperText={<TextLimitIndicator currentLength={characterTriggersDraft.length} maxLength={600} />}
                  FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                />
                {!characterNameDraft.trim() || !characterDescriptionDraft.trim() ? (
                  <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.83rem' }}>
                    Имя и описание обязательны для сохранения персонажа.
                  </Typography>
                ) : null}
              </Stack>
            </Box>
          </Stack>
        
      </FormDialog>

      <InstructionTemplateDialog
        open={instructionTemplateDialogOpen}
        authToken={authToken}
        mode="picker"
        selectedTemplateSignatures={selectedInstructionTemplateSignatures}
        onClose={() => setInstructionTemplateDialogOpen(false)}
        onSelectTemplate={(template) => handleApplyInstructionTemplate(template)}
      />

      <AvatarCropDialog
        open={Boolean(characterAvatarCropSource)}
        imageSrc={characterAvatarCropSource}
        onCancel={handleCancelCharacterAvatarCrop}
        onSave={handleSaveCharacterAvatarCrop}
      />

      {coverCropSource ? (
        <ImageCropper
          imageSrc={coverCropSource}
          aspect={16 / 9}
          frameRadius={12}
          title="Настройка обложки"
          onCancel={handleCancelCoverCrop}
          onSave={handleSaveCoverCrop}
        />
      ) : null}
    </Box>
  )
}

export default WorldCreatePage

