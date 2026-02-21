import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AppHeader from '../components/AppHeader'
import { icons } from '../assets'
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
import { compressImageFileToDataUrl } from '../utils/avatar'

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
const AVATAR_SCALE_MIN = 1
const AVATAR_SCALE_MAX = 3
const COVER_SCALE_MIN = 1
const COVER_SCALE_MAX = 3
const COVER_MAX_BYTES = 200 * 1024
const CARD_WIDTH = 286

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
      <Box sx={{ width: size, height: size, borderRadius: '50%', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, background: 'rgba(12, 17, 25, 0.72)', display: 'grid', placeItems: 'center', color: APP_TEXT_PRIMARY, fontWeight: 800, flexShrink: 0 }}>
        {label.trim().charAt(0).toUpperCase() || '•'}
      </Box>
    )
  }
  return (
    <Box sx={{ width: size, height: size, borderRadius: '50%', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, background: 'rgba(12, 17, 25, 0.72)', overflow: 'hidden', flexShrink: 0 }}>
      <Box component="img" src={avatarUrl} alt={label} sx={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${clamp(avatarScale, AVATAR_SCALE_MIN, AVATAR_SCALE_MAX)})`, transformOrigin: 'center center' }} />
    </Box>
  )
}

function CompactCard({ title, content, badge, avatar, actions }: { title: string; content: string; badge?: string; avatar?: ReactNode; actions?: ReactNode }) {
  return (
    <Box sx={{ width: { xs: '100%', sm: CARD_WIDTH }, minHeight: 186, borderRadius: 'var(--morius-radius)', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, background: 'linear-gradient(180deg, rgba(17, 24, 35, 0.96) 0%, rgba(11, 16, 24, 0.97) 100%)', boxShadow: '0 12px 28px rgba(0, 0, 0, 0.24)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 1.1, py: 0.85, borderBottom: `var(--morius-border-width) solid rgba(108, 130, 160, 0.22)`, background: 'linear-gradient(180deg, rgba(17, 31, 51, 0.84) 0%, rgba(11, 22, 39, 0.68) 100%)' }}>
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
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false)
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
  const [isLoading, setIsLoading] = useState(Boolean(isEditMode))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<StoryGameVisibility>('private')
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null)
  const [coverScale, setCoverScale] = useState(1)
  const [coverPositionX, setCoverPositionX] = useState(50)
  const [coverPositionY, setCoverPositionY] = useState(50)
  const [coverEditorOpen, setCoverEditorOpen] = useState(false)
  const [coverScaleDraft, setCoverScaleDraft] = useState(1)
  const [coverPositionXDraft, setCoverPositionXDraft] = useState(50)
  const [coverPositionYDraft, setCoverPositionYDraft] = useState(50)

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

  const [characterPickerTarget, setCharacterPickerTarget] = useState<'main_hero' | 'npc' | null>(null)
  const [characterDialogOpen, setCharacterDialogOpen] = useState(false)
  const [characterDialogTarget, setCharacterDialogTarget] = useState<'main_hero' | 'npc'>('npc')
  const [characterDialogTargetLocalId, setCharacterDialogTargetLocalId] = useState<string | null>(null)
  const [characterNameDraft, setCharacterNameDraft] = useState('')
  const [characterDescriptionDraft, setCharacterDescriptionDraft] = useState('')
  const [characterTriggersDraft, setCharacterTriggersDraft] = useState('')
  const [characterAvatarDraft, setCharacterAvatarDraft] = useState<string | null>(null)
  const [characterAvatarScaleDraft, setCharacterAvatarScaleDraft] = useState(1)

  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const characterAvatarInputRef = useRef<HTMLInputElement | null>(null)
  const sortedCharacters = useMemo(() => [...characters].sort((a, b) => a.name.localeCompare(b.name, 'ru-RU')), [characters])
  const canSubmit = useMemo(
    () => !isSubmitting && !isLoading && Boolean(title.trim() && mainHero?.name.trim() && mainHero.description.trim()),
    [isLoading, isSubmitting, mainHero, title],
  )

  const persistTitleForGame = useCallback((gameId: number, nextTitle: string) => {
    const next = setStoryTitle(loadStoryTitleMap(), gameId, nextTitle)
    persistStoryTitleMap(next)
  }, [])

  const getTemplateDisabledReason = useCallback(
    (characterId: number, target: 'main_hero' | 'npc'): string | null => {
      if (target === 'main_hero') {
        return npcs.some((npc) => npc.character_id === characterId) ? 'Этот персонаж уже добавлен в NPC.' : null
      }
      if (mainHero?.character_id === characterId) {
        return 'Этот персонаж уже выбран как главный герой.'
      }
      return npcs.some((npc) => npc.character_id === characterId) ? 'Этот персонаж уже есть в списке NPC.' : null
    },
    [mainHero?.character_id, npcs],
  )

  const hasTemplateConflicts = useCallback((hero: EditableCharacterCard, nextNpcs: EditableCharacterCard[]) => {
    const usedNpcTemplates = new Set<number>()
    for (const npc of nextNpcs) {
      if (!npc.character_id) continue
      if (hero.character_id && npc.character_id === hero.character_id) return true
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
        setVisibility(payload.game.visibility)
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
      setCoverImageUrl(dataUrl)
      setCoverScale(1)
      setCoverPositionX(50)
      setCoverPositionY(50)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось загрузить обложку')
    }
  }, [])

  const openCoverEditor = useCallback(() => {
    setCoverScaleDraft(coverScale)
    setCoverPositionXDraft(coverPositionX)
    setCoverPositionYDraft(coverPositionY)
    setCoverEditorOpen(true)
  }, [coverPositionX, coverPositionY, coverScale])

  const saveCoverEditor = useCallback(() => {
    setCoverScale(clamp(coverScaleDraft, COVER_SCALE_MIN, COVER_SCALE_MAX))
    setCoverPositionX(clamp(coverPositionXDraft, 0, 100))
    setCoverPositionY(clamp(coverPositionYDraft, 0, 100))
    setCoverEditorOpen(false)
  }, [coverPositionXDraft, coverPositionYDraft, coverScaleDraft])

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
      const dataUrl = await compressImageFileToDataUrl(file, { maxBytes: COVER_MAX_BYTES, maxDimension: 1200 })
      setCharacterAvatarDraft(dataUrl)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось загрузить аватар')
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
    const reason = getTemplateDisabledReason(character.id, characterPickerTarget)
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
    if (!canSubmit || !mainHero) return
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
      if (gameId === null) {
        const created = await createStoryGame({
          token: authToken,
          title: normalizedTitle,
          description: normalizedDescription,
          visibility,
          cover_image_url: coverImageUrl,
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
          cover_image_url: coverImageUrl,
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
      if (existingMainHero) {
        await updateStoryWorldCard({ token: authToken, gameId, cardId: existingMainHero.id, title: mainHero.name, content: mainHero.description, triggers: parseTriggers(mainHero.triggers, mainHero.name) })
        await updateStoryWorldCardAvatar({ token: authToken, gameId, cardId: existingMainHero.id, avatar_url: mainHero.avatar_url, avatar_scale: mainHero.avatar_scale })
      } else {
        await createStoryWorldCard({ token: authToken, gameId, kind: 'main_hero', title: mainHero.name, content: mainHero.description, triggers: parseTriggers(mainHero.triggers, mainHero.name), avatar_url: mainHero.avatar_url, avatar_scale: mainHero.avatar_scale })
      }
      const existingNpcs = latest.world_cards.filter((card) => card.kind === 'npc')
      for (const npc of npcs) {
        if (npc.id && existingNpcs.some((item) => item.id === npc.id)) {
          await updateStoryWorldCard({ token: authToken, gameId, cardId: npc.id, title: npc.name, content: npc.description, triggers: parseTriggers(npc.triggers, npc.name) })
          await updateStoryWorldCardAvatar({ token: authToken, gameId, cardId: npc.id, avatar_url: npc.avatar_url, avatar_scale: npc.avatar_scale })
        } else {
          await createStoryWorldCard({ token: authToken, gameId, kind: 'npc', title: npc.name, content: npc.description, triggers: parseTriggers(npc.triggers, npc.name), avatar_url: npc.avatar_url, avatar_scale: npc.avatar_scale })
        }
      }
      for (const npc of existingNpcs) if (!npcs.some((item) => item.id === npc.id)) await deleteStoryWorldCard({ token: authToken, gameId, cardId: npc.id })
      persistTitleForGame(gameId, normalizedTitle)
      onNavigate(`/home/${gameId}`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось сохранить мир')
    } finally {
      setIsSubmitting(false)
    }
  }, [authToken, canSubmit, coverImageUrl, coverPositionX, coverPositionY, coverScale, description, editingGameId, hasTemplateConflicts, instructionCards, mainHero, npcs, onNavigate, persistTitleForGame, plotCards, title, visibility])

  const helpEmpty = (text: string) => (
    <Box sx={{ borderRadius: '12px', border: `var(--morius-border-width) dashed rgba(170, 188, 214, 0.34)`, background: 'rgba(11, 16, 24, 0.52)', p: 1.1 }}><Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>{text}</Typography></Box>
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
        rightActions={<Button onClick={() => onNavigate('/games')} sx={{ minWidth: 48, minHeight: 48, p: 0, borderRadius: '50%' }}><Box component="img" src={user.avatar_url ?? icons.home} alt="" sx={{ width: moriusThemeTokens.layout.headerButtonSize, height: moriusThemeTokens.layout.headerButtonSize, borderRadius: '50%' }} /></Button>}
      />
      <Box sx={{ pt: '86px', px: { xs: 2, md: 3 }, pb: 4 }}>
        <Box sx={{ maxWidth: 1160, mx: 'auto', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, borderRadius: 'var(--morius-radius)', background: APP_CARD_BACKGROUND, p: { xs: 1.4, md: 1.8 } }}>
          {errorMessage ? <Alert severity="error" onClose={() => setErrorMessage('')} sx={{ mb: 1.4, borderRadius: '12px' }}>{errorMessage}</Alert> : null}
          {isLoading ? <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress /></Stack> : <Stack spacing={1.5}>
            <Stack spacing={0.35}><Typography sx={{ fontSize: { xs: '1.65rem', md: '1.9rem' }, fontWeight: 800 }}>{heroTitle}</Typography><Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.95rem' }}>Заполните мир и добавьте карточки. После создания он сразу откроется в игре.</Typography></Stack>
            <TextField label="Название мира" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth inputProps={{ maxLength: 140 }} />
            <TextField label="Краткое описание" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth multiline minRows={3} maxRows={8} inputProps={{ maxLength: 1000 }} />
            <Divider />
            <Stack spacing={0.95}>
              <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" flexWrap="wrap"><Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>Обложка мира</Typography><Stack direction="row" spacing={0.8}><Button onClick={() => coverInputRef.current?.click()} sx={{ minHeight: 36 }}>{coverImageUrl ? 'Изменить' : 'Загрузить'}</Button><Button onClick={openCoverEditor} disabled={!coverImageUrl} sx={{ minHeight: 36 }}>Настроить кадр</Button><Button onClick={() => setCoverImageUrl(null)} disabled={!coverImageUrl} sx={{ minHeight: 36, color: APP_TEXT_SECONDARY }}>Удалить</Button></Stack></Stack>
              <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleCoverUpload} style={{ display: 'none' }} />
              <Box sx={{ minHeight: 208, borderRadius: 'var(--morius-radius)', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, backgroundImage: coverImageUrl ? `url(${coverImageUrl})` : 'linear-gradient(145deg, rgba(19, 30, 48, 0.95), rgba(10, 16, 28, 0.98))', backgroundSize: coverImageUrl ? `${coverScale * 100}%` : 'cover', backgroundPosition: `${coverPositionX}% ${coverPositionY}%` }} />
              <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem' }}>Лимит файла: 200 KB. Изображение автоматически сжимается перед сохранением.</Typography>
            </Stack>
            <Divider />
            <Stack spacing={0.75}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>Карточки инструкций</Typography><Button onClick={() => openCardDialog('instruction')} sx={{ minHeight: 36 }}>Добавить</Button></Stack>{instructionCards.length === 0 ? helpEmpty('Добавьте первую инструкцию. Например: стиль повествования, ограничения или тон диалогов.') : <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{instructionCards.map((card) => <CompactCard key={card.localId} title={card.title} content={card.content} badge="активна" actions={<><Button onClick={() => openCardDialog('instruction', card)} sx={{ minHeight: 30, px: 1.05 }}>Изменить</Button><Button onClick={() => setInstructionCards((p) => p.filter((i) => i.localId !== card.localId))} sx={{ minHeight: 30, px: 1.05, color: APP_TEXT_SECONDARY }}>Удалить</Button></>} />)}</Box>}</Stack>
            <Divider />
            <Stack spacing={0.75}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>Карточки сюжета</Typography><Button onClick={() => openCardDialog('plot')} sx={{ minHeight: 36 }}>Добавить</Button></Stack>{plotCards.length === 0 ? helpEmpty('Сюжетные карточки помогут быстро держать контекст истории и ключевые события.') : <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{plotCards.map((card) => <CompactCard key={card.localId} title={card.title} content={card.content} badge="активна" actions={<><Button onClick={() => openCardDialog('plot', card)} sx={{ minHeight: 30, px: 1.05 }}>Изменить</Button><Button onClick={() => setPlotCards((p) => p.filter((i) => i.localId !== card.localId))} sx={{ minHeight: 30, px: 1.05, color: APP_TEXT_SECONDARY }}>Удалить</Button></>} />)}</Box>}</Stack>
            <Divider />
            <Stack spacing={0.75}><Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap"><Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>Главный герой</Typography><Stack direction="row" spacing={0.8}><Button onClick={() => setCharacterPickerTarget('main_hero')} sx={{ minHeight: 36 }}>Из «Мои персонажи»</Button><Button onClick={() => openCharacterDialog('main_hero', mainHero ?? undefined)} sx={{ minHeight: 36 }}>{mainHero ? 'Редактировать вручную' : 'Создать вручную'}</Button></Stack></Stack>{mainHero ? <CompactCard title={mainHero.name} content={`${mainHero.description}${mainHero.triggers.trim() ? `\nТриггеры: ${mainHero.triggers.trim()}` : ''}`} badge="гг" avatar={<MiniAvatar avatarUrl={mainHero.avatar_url} avatarScale={mainHero.avatar_scale} label={mainHero.name} size={38} />} actions={<><Button onClick={() => openCharacterDialog('main_hero', mainHero)} sx={{ minHeight: 30, px: 1.05 }}>Изменить</Button><Button onClick={() => setMainHero(null)} sx={{ minHeight: 30, px: 1.05, color: APP_TEXT_SECONDARY }}>Убрать</Button></>} /> : helpEmpty('Выберите ГГ из «Мои персонажи» или создайте его вручную.')}</Stack>
            <Divider />
            <Stack spacing={0.75}><Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap"><Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>NPC</Typography><Stack direction="row" spacing={0.8}><Button onClick={() => setCharacterPickerTarget('npc')} sx={{ minHeight: 36 }}>Из «Мои персонажи»</Button><Button onClick={() => openCharacterDialog('npc')} sx={{ minHeight: 36 }}>Добавить вручную</Button></Stack></Stack>{npcs.length === 0 ? helpEmpty('Пока NPC не добавлены. Можно начать игру только с главным героем и добавить NPC позже.') : <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{npcs.map((npc) => <CompactCard key={npc.localId} title={npc.name} content={`${npc.description}${npc.triggers.trim() ? `\nТриггеры: ${npc.triggers.trim()}` : ''}`} badge="npc" avatar={<MiniAvatar avatarUrl={npc.avatar_url} avatarScale={npc.avatar_scale} label={npc.name} size={38} />} actions={<><Button onClick={() => openCharacterDialog('npc', npc)} sx={{ minHeight: 30, px: 1.05 }}>Изменить</Button><Button onClick={() => setNpcs((p) => p.filter((i) => i.localId !== npc.localId))} sx={{ minHeight: 30, px: 1.05, color: APP_TEXT_SECONDARY }}>Удалить</Button></>} />)}</Box>}</Stack>
            <Divider />
            <Stack spacing={0.75}><Typography sx={{ fontWeight: 800, fontSize: '1.04rem' }}>Видимость мира</Typography><Stack direction="row" spacing={0.8}><Button onClick={() => setVisibility('private')} sx={{ minHeight: 38, border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, backgroundColor: visibility === 'private' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND }}>Приватный</Button><Button onClick={() => setVisibility('public')} sx={{ minHeight: 38, border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, backgroundColor: visibility === 'public' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND }}>Публичный</Button></Stack></Stack>
            <Stack direction="row" spacing={0.8} justifyContent="flex-end"><Button onClick={() => onNavigate('/games')} sx={{ minHeight: 38, color: APP_TEXT_SECONDARY }}>Отмена</Button><Button onClick={() => void handleSaveWorld()} disabled={!canSubmit} sx={{ minHeight: 38, border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, color: APP_TEXT_PRIMARY, backgroundColor: APP_BUTTON_ACTIVE, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>{isSubmitting ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : isEditMode ? 'Сохранить' : 'Создать'}</Button></Stack>
          </Stack>}
        </Box>
      </Box>

      <Dialog open={cardDialogOpen} onClose={() => setCardDialogOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={{ pb: 0.85 }}>
          <Stack spacing={0.3}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.45rem' }}>{cardDialogKind === 'instruction' ? 'Карточка инструкции' : 'Карточка сюжета'}</Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>Заполните карточку. Пустые карточки не сохраняются.</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.4 }}>
          <Stack spacing={1}>
            <TextField label="Заголовок" value={cardTitleDraft} onChange={(e) => setCardTitleDraft(e.target.value)} fullWidth inputProps={{ maxLength: 140 }} />
            <TextField label="Содержание" value={cardContentDraft} onChange={(e) => setCardContentDraft(e.target.value)} fullWidth multiline minRows={4} maxRows={10} inputProps={{ maxLength: 6000 }} />
            {!cardTitleDraft.trim() || !cardContentDraft.trim() ? <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.83rem' }}>Введите заголовок и текст карточки, чтобы кнопка сохранения стала доступна.</Typography> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={() => setCardDialogOpen(false)} sx={{ color: APP_TEXT_SECONDARY }}>Отмена</Button>
          <Button onClick={saveCardDialog} disabled={!cardTitleDraft.trim() || !cardContentDraft.trim()} sx={{ border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, backgroundColor: APP_BUTTON_ACTIVE, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={characterPickerTarget !== null} onClose={() => setCharacterPickerTarget(null)} maxWidth="sm" fullWidth PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={{ pb: 0.75 }}>
          <Stack spacing={0.3}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.45rem' }}>{characterPickerTarget === 'main_hero' ? 'Выбрать главного героя' : 'Выбрать NPC'}</Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>Выберите персонажа из ваших заготовок. Дубли между ГГ и NPC запрещены.</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.35 }}>
          <Stack spacing={0.8}>
            {sortedCharacters.length === 0 ? helpEmpty('У вас пока нет сохранённых персонажей. Сначала добавьте их в разделе «Мои персонажи».') : sortedCharacters.map((character) => {
              const disabledReason = characterPickerTarget ? getTemplateDisabledReason(character.id, characterPickerTarget) : null
              return (
                <Box key={character.id} sx={{ borderRadius: '12px', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, background: 'rgba(13, 19, 29, 0.78)', px: 0.85, py: 0.75 }}>
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
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={() => setCharacterPickerTarget(null)} sx={{ color: APP_TEXT_SECONDARY }}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={characterDialogOpen} onClose={() => setCharacterDialogOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={{ pb: 0.8 }}>
          <Stack spacing={0.3}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.45rem' }}>{characterDialogTarget === 'main_hero' ? 'Главный герой' : 'NPC'}</Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>Если не загрузить изображение, будет использована заглушка.</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.35 }}>
          <Stack spacing={1}>
            <input ref={characterAvatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleCharacterAvatarUpload} style={{ display: 'none' }} />
            <Box role="button" tabIndex={0} aria-label="Загрузить аватар персонажа" onClick={() => characterAvatarInputRef.current?.click()} onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                characterAvatarInputRef.current?.click()
              }
            }} sx={{ width: 176, height: 176, mx: 'auto', borderRadius: '50%', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, overflow: 'hidden', cursor: 'pointer', outline: 'none', background: 'rgba(12, 17, 25, 0.72)' }}>
              <MiniAvatar avatarUrl={characterAvatarDraft} avatarScale={characterAvatarScaleDraft} label={characterNameDraft || 'Персонаж'} size={176} />
            </Box>
            <Stack direction="row" justifyContent="center" spacing={0.8}>
              <Button onClick={() => characterAvatarInputRef.current?.click()} sx={{ minHeight: 34 }}>Загрузить</Button>
              <Button onClick={() => setCharacterAvatarDraft(null)} sx={{ minHeight: 34, color: APP_TEXT_SECONDARY }}>Удалить</Button>
            </Stack>
            <Box>
              <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem' }}>Масштаб аватара: {characterAvatarScaleDraft.toFixed(2)}x</Typography>
              <Slider min={AVATAR_SCALE_MIN} max={AVATAR_SCALE_MAX} step={0.05} value={characterAvatarScaleDraft} onChange={(_, value) => setCharacterAvatarScaleDraft(value as number)} />
            </Box>
            <TextField label="Имя" value={characterNameDraft} onChange={(e) => setCharacterNameDraft(e.target.value)} fullWidth inputProps={{ maxLength: 140 }} />
            <TextField label="Описание" value={characterDescriptionDraft} onChange={(e) => setCharacterDescriptionDraft(e.target.value)} fullWidth multiline minRows={3} maxRows={8} inputProps={{ maxLength: 6000 }} />
            <TextField label="Триггеры (через запятую)" value={characterTriggersDraft} onChange={(e) => setCharacterTriggersDraft(e.target.value)} fullWidth inputProps={{ maxLength: 600 }} />
            {!characterNameDraft.trim() || !characterDescriptionDraft.trim() ? <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.83rem' }}>Имя и описание обязательны для сохранения персонажа.</Typography> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={() => setCharacterDialogOpen(false)} sx={{ color: APP_TEXT_SECONDARY }}>Отмена</Button>
          <Button onClick={saveCharacterDialog} disabled={!characterNameDraft.trim() || !characterDescriptionDraft.trim()} sx={{ border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, backgroundColor: APP_BUTTON_ACTIVE, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={coverEditorOpen} onClose={() => setCoverEditorOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={{ pb: 0.8 }}>
          <Stack spacing={0.3}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.45rem' }}>Кадрирование обложки</Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>Настройте масштаб и позицию. Превью показывает итоговый вид карточки мира.</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.45 }}>
          <Stack spacing={1}>
            <Box sx={{ height: { xs: 210, sm: 290 }, borderRadius: 'var(--morius-radius)', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, backgroundImage: coverImageUrl ? `url(${coverImageUrl})` : 'linear-gradient(145deg, rgba(19, 30, 48, 0.95), rgba(10, 16, 28, 0.98))', backgroundSize: coverImageUrl ? `${coverScaleDraft * 100}%` : 'cover', backgroundPosition: `${coverPositionXDraft}% ${coverPositionYDraft}%` }} />
            {!coverImageUrl ? <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.84rem' }}>Пока нет обложки. Сначала загрузите изображение.</Typography> : <>
              <Box>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem' }}>Масштаб: {coverScaleDraft.toFixed(2)}x</Typography>
                <Slider min={COVER_SCALE_MIN} max={COVER_SCALE_MAX} step={0.05} value={coverScaleDraft} onChange={(_, value) => setCoverScaleDraft(value as number)} />
              </Box>
              <Box>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem' }}>Позиция X: {Math.round(coverPositionXDraft)}%</Typography>
                <Slider min={0} max={100} step={1} value={coverPositionXDraft} onChange={(_, value) => setCoverPositionXDraft(value as number)} />
              </Box>
              <Box>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem' }}>Позиция Y: {Math.round(coverPositionYDraft)}%</Typography>
                <Slider min={0} max={100} step={1} value={coverPositionYDraft} onChange={(_, value) => setCoverPositionYDraft(value as number)} />
              </Box>
            </>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={() => setCoverEditorOpen(false)} sx={{ color: APP_TEXT_SECONDARY }}>Назад</Button>
          <Button onClick={saveCoverEditor} disabled={!coverImageUrl} sx={{ border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, backgroundColor: APP_BUTTON_ACTIVE, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>Сохранить</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default WorldCreatePage
