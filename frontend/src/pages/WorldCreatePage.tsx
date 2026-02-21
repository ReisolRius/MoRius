import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
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

type EditableCard = { localId: string; id?: number; title: string; content: string }
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

function makeLocalId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function parseTriggers(value: string, fallback: string): string[] {
  const items = value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean)
  const unique = Array.from(new Set(items))
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
    avatar_scale: Math.min(AVATAR_SCALE_MAX, Math.max(AVATAR_SCALE_MIN, character.avatar_scale ?? 1)),
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
    avatar_scale: Math.min(AVATAR_SCALE_MAX, Math.max(AVATAR_SCALE_MIN, card.avatar_scale ?? 1)),
  }
}

function MiniAvatar({ avatarUrl, avatarScale, label }: { avatarUrl: string | null; avatarScale: number; label: string }) {
  if (!avatarUrl) {
    return (
      <Box sx={{ width: 52, height: 52, borderRadius: '12px', border: `1px solid ${APP_BORDER_COLOR}`, display: 'grid', placeItems: 'center' }}>
        {label.trim().charAt(0).toUpperCase() || '•'}
      </Box>
    )
  }
  return (
    <Box sx={{ width: 52, height: 52, borderRadius: '12px', border: `1px solid ${APP_BORDER_COLOR}`, overflow: 'hidden' }}>
      <Box component="img" src={avatarUrl} alt={label} sx={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${avatarScale})` }} />
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

  const canSubmit = useMemo(() => {
    if (isSubmitting || isLoading) {
      return false
    }
    return Boolean(title.trim() && mainHero?.name.trim() && mainHero.description.trim())
  }, [isLoading, isSubmitting, mainHero, title])

  useEffect(() => {
    let active = true
    listStoryCharacters(authToken).then((items) => active && setCharacters(items)).catch(() => active && setCharacters([]))
    return () => {
      active = false
    }
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
    return () => {
      active = false
    }
  }, [authToken, editingGameId, isEditMode])

  const handleCoverUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const dataUrl = await compressImageFileToDataUrl(file, { maxBytes: COVER_MAX_BYTES, maxDimension: 1800 })
      setCoverImageUrl(dataUrl)
      setCoverScale(1)
      setCoverPositionX(50)
      setCoverPositionY(50)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось загрузить обложку')
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
    try {
      const dataUrl = await compressImageFileToDataUrl(file, { maxBytes: COVER_MAX_BYTES, maxDimension: 1024 })
      setCharacterAvatarDraft(dataUrl)
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
      avatar_scale: Math.min(AVATAR_SCALE_MAX, Math.max(AVATAR_SCALE_MIN, characterAvatarScaleDraft)),
    }
    if (!next.name || !next.description) return
    if (characterDialogTarget === 'main_hero') {
      setMainHero((prev) => (prev ? { ...next, id: prev.id } : next))
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
    const card = toEditableCharacterFromTemplate(character)
    if (characterPickerTarget === 'main_hero') {
      setMainHero((prev) => (prev ? { ...card, id: prev.id } : card))
    } else if (characterPickerTarget === 'npc') {
      setNpcs((prev) => [...prev, card])
    }
    setCharacterPickerTarget(null)
  }, [characterPickerTarget])

  const handleSaveWorld = useCallback(async () => {
    if (!canSubmit || !mainHero) return
    setIsSubmitting(true)
    setErrorMessage('')
    try {
      let gameId = editingGameId
      if (gameId === null) {
        const created = await createStoryGame({ token: authToken, title: title.trim(), description, visibility, cover_image_url: coverImageUrl, cover_scale: coverScale, cover_position_x: coverPositionX, cover_position_y: coverPositionY })
        gameId = created.id
      } else {
        await updateStoryGameMeta({ token: authToken, gameId, title: title.trim(), description, visibility, cover_image_url: coverImageUrl, cover_scale: coverScale, cover_position_x: coverPositionX, cover_position_y: coverPositionY })
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
      onNavigate(`/home/${gameId}`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось сохранить мир')
    } finally {
      setIsSubmitting(false)
    }
  }, [authToken, canSubmit, coverImageUrl, coverPositionX, coverPositionY, coverScale, description, editingGameId, instructionCards, mainHero, npcs, onNavigate, plotCards, title, visibility])

  return (
    <Box sx={{ minHeight: '100svh', color: APP_TEXT_PRIMARY, background: APP_PAGE_BACKGROUND }}>
      <AppHeader
        isPageMenuOpen={isPageMenuOpen}
        onTogglePageMenu={() => setIsPageMenuOpen((previous) => !previous)}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: false, onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', isActive: false, onClick: () => onNavigate('/games') },
          { key: 'world-create', label: isEditMode ? 'Редактирование мира' : 'Создание мира', isActive: true, onClick: () => onNavigate('/worlds/new') },
        ]}
        pageMenuLabels={{ expanded: 'Свернуть меню', collapsed: 'Открыть меню' }}
        isRightPanelOpen={isHeaderActionsOpen}
        onToggleRightPanel={() => setIsHeaderActionsOpen((previous) => !previous)}
        rightToggleLabels={{ expanded: 'Скрыть действия', collapsed: 'Показать действия' }}
        rightActions={<Button onClick={() => onNavigate('/games')} sx={{ minWidth: 48, minHeight: 48, p: 0, borderRadius: '50%' }}><Box component="img" src={user.avatar_url ?? icons.home} alt="" sx={{ width: moriusThemeTokens.layout.headerButtonSize, height: moriusThemeTokens.layout.headerButtonSize, borderRadius: '50%' }} /></Button>}
      />
      <Box sx={{ pt: '86px', px: { xs: 2, md: 3 }, pb: 4 }}>
        <Box sx={{ maxWidth: 980, mx: 'auto', border: `1px solid ${APP_BORDER_COLOR}`, borderRadius: '18px', background: APP_CARD_BACKGROUND, p: 2 }}>
          {errorMessage ? <Alert severity="error" onClose={() => setErrorMessage('')} sx={{ mb: 2 }}>{errorMessage}</Alert> : null}
          {isLoading ? (
            <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress /></Stack>
          ) : (
            <Stack spacing={1.5}>
              <Typography sx={{ fontSize: '1.8rem', fontWeight: 800 }}>{isEditMode ? 'Редактирование мира' : 'Создание мира'}</Typography>
              <TextField label="Название мира" value={title} onChange={(event) => setTitle(event.target.value)} fullWidth />
              <TextField label="Краткое описание" value={description} onChange={(event) => setDescription(event.target.value)} fullWidth multiline minRows={3} />
              <Divider />
              <Stack spacing={0.8}>
                <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>Обложка мира</Typography><Stack direction="row" spacing={1}><Button onClick={() => coverInputRef.current?.click()} sx={{ textTransform: 'none' }}>Загрузить</Button><Button onClick={() => setCoverImageUrl(null)} sx={{ textTransform: 'none', color: APP_TEXT_SECONDARY }}>Удалить</Button></Stack></Stack>
                <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleCoverUpload} style={{ display: 'none' }} />
                <Box sx={{ height: 190, border: `1px solid ${APP_BORDER_COLOR}`, borderRadius: '12px', backgroundImage: coverImageUrl ? `url(${coverImageUrl})` : 'linear-gradient(145deg, rgba(19,30,48,.95), rgba(10,16,28,.98))', backgroundSize: coverImageUrl ? `${coverScale * 100}%` : 'cover', backgroundPosition: `${coverPositionX}% ${coverPositionY}%` }} />
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem' }}>Лимит 200KB, изображение автоматически сжимается.</Typography>
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem' }}>Масштаб: {coverScale.toFixed(2)}x</Typography><Slider min={COVER_SCALE_MIN} max={COVER_SCALE_MAX} step={0.05} value={coverScale} onChange={(_, value) => setCoverScale(value as number)} />
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem' }}>Позиция X: {Math.round(coverPositionX)}%</Typography><Slider min={0} max={100} step={1} value={coverPositionX} onChange={(_, value) => setCoverPositionX(value as number)} />
                <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem' }}>Позиция Y: {Math.round(coverPositionY)}%</Typography><Slider min={0} max={100} step={1} value={coverPositionY} onChange={(_, value) => setCoverPositionY(value as number)} />
              </Stack>
              <Divider />
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>Карточки инструкций</Typography><Button onClick={() => openCardDialog('instruction')} sx={{ textTransform: 'none' }}>Добавить</Button></Stack>
              {instructionCards.map((card) => <Box key={card.localId} sx={{ border: `1px solid ${APP_BORDER_COLOR}`, borderRadius: '10px', p: 1 }}><Typography sx={{ fontWeight: 700 }}>{card.title}</Typography><Typography sx={{ color: APP_TEXT_SECONDARY }}>{card.content}</Typography><Stack direction="row" spacing={1}><Button onClick={() => openCardDialog('instruction', card)} sx={{ textTransform: 'none' }}>Изменить</Button><Button onClick={() => setInstructionCards((prev) => prev.filter((item) => item.localId !== card.localId))} sx={{ textTransform: 'none', color: APP_TEXT_SECONDARY }}>Удалить</Button></Stack></Box>)}
              <Divider />
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>Карточки сюжета</Typography><Button onClick={() => openCardDialog('plot')} sx={{ textTransform: 'none' }}>Добавить</Button></Stack>
              {plotCards.map((card) => <Box key={card.localId} sx={{ border: `1px solid ${APP_BORDER_COLOR}`, borderRadius: '10px', p: 1 }}><Typography sx={{ fontWeight: 700 }}>{card.title}</Typography><Typography sx={{ color: APP_TEXT_SECONDARY }}>{card.content}</Typography><Stack direction="row" spacing={1}><Button onClick={() => openCardDialog('plot', card)} sx={{ textTransform: 'none' }}>Изменить</Button><Button onClick={() => setPlotCards((prev) => prev.filter((item) => item.localId !== card.localId))} sx={{ textTransform: 'none', color: APP_TEXT_SECONDARY }}>Удалить</Button></Stack></Box>)}
              <Divider />
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>Главный герой</Typography><Stack direction="row" spacing={1}><Button onClick={() => setCharacterPickerTarget('main_hero')} sx={{ textTransform: 'none' }}>Из «Мои персонажи»</Button><Button onClick={() => openCharacterDialog('main_hero', mainHero ?? undefined)} sx={{ textTransform: 'none' }}>Создать вручную</Button></Stack></Stack>
              {mainHero ? <Box sx={{ border: `1px solid ${APP_BORDER_COLOR}`, borderRadius: '10px', p: 1 }}><Stack direction="row" spacing={1}><MiniAvatar avatarUrl={mainHero.avatar_url} avatarScale={mainHero.avatar_scale} label={mainHero.name} /><Stack><Typography sx={{ fontWeight: 700 }}>{mainHero.name}</Typography><Typography sx={{ color: APP_TEXT_SECONDARY }}>{mainHero.description}</Typography><Button onClick={() => openCharacterDialog('main_hero', mainHero)} sx={{ textTransform: 'none' }}>Изменить</Button></Stack></Stack></Box> : <Typography sx={{ color: APP_TEXT_SECONDARY }}>Герой не выбран.</Typography>}
              <Divider />
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>NPC</Typography><Stack direction="row" spacing={1}><Button onClick={() => setCharacterPickerTarget('npc')} sx={{ textTransform: 'none' }}>Из «Мои персонажи»</Button><Button onClick={() => openCharacterDialog('npc')} sx={{ textTransform: 'none' }}>Добавить вручную</Button></Stack></Stack>
              {npcs.map((npc) => <Box key={npc.localId} sx={{ border: `1px solid ${APP_BORDER_COLOR}`, borderRadius: '10px', p: 1 }}><Stack direction="row" spacing={1}><MiniAvatar avatarUrl={npc.avatar_url} avatarScale={npc.avatar_scale} label={npc.name} /><Stack sx={{ flex: 1 }}><Typography sx={{ fontWeight: 700 }}>{npc.name}</Typography><Typography sx={{ color: APP_TEXT_SECONDARY }}>{npc.description}</Typography><Stack direction="row" spacing={1}><Button onClick={() => openCharacterDialog('npc', npc)} sx={{ textTransform: 'none' }}>Изменить</Button><Button onClick={() => setNpcs((prev) => prev.filter((item) => item.localId !== npc.localId))} sx={{ textTransform: 'none', color: APP_TEXT_SECONDARY }}>Удалить</Button></Stack></Stack></Stack></Box>)}
              <Divider />
              <Typography sx={{ fontWeight: 700 }}>Видимость мира</Typography>
              <Stack direction="row" spacing={1}><Button onClick={() => setVisibility('private')} sx={{ textTransform: 'none', border: `1px solid ${APP_BORDER_COLOR}`, backgroundColor: visibility === 'private' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND }}>Приватный</Button><Button onClick={() => setVisibility('public')} sx={{ textTransform: 'none', border: `1px solid ${APP_BORDER_COLOR}`, backgroundColor: visibility === 'public' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND }}>Публичный</Button></Stack>
              <Stack direction="row" spacing={1} justifyContent="flex-end"><Button onClick={() => onNavigate('/games')} sx={{ textTransform: 'none', color: APP_TEXT_SECONDARY }}>Отмена</Button><Button onClick={() => void handleSaveWorld()} disabled={!canSubmit} sx={{ textTransform: 'none', border: `1px solid ${APP_BORDER_COLOR}`, color: APP_TEXT_PRIMARY, backgroundColor: APP_BUTTON_ACTIVE, '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>{isSubmitting ? <CircularProgress size={16} /> : isEditMode ? 'Сохранить' : 'Создать'}</Button></Stack>
            </Stack>
          )}
        </Box>
      </Box>

      <Dialog open={cardDialogOpen} onClose={() => setCardDialogOpen(false)} fullWidth maxWidth="sm"><DialogTitle>{cardDialogKind === 'instruction' ? 'Карточка инструкции' : 'Карточка сюжета'}</DialogTitle><DialogContent><Stack spacing={1}><TextField label="Заголовок" value={cardTitleDraft} onChange={(event) => setCardTitleDraft(event.target.value)} fullWidth /><TextField label="Содержание" value={cardContentDraft} onChange={(event) => setCardContentDraft(event.target.value)} fullWidth multiline minRows={4} /></Stack></DialogContent><DialogActions><Button onClick={() => setCardDialogOpen(false)}>Отмена</Button><Button onClick={saveCardDialog}>Сохранить</Button></DialogActions></Dialog>
      <Dialog open={characterPickerTarget !== null} onClose={() => setCharacterPickerTarget(null)} fullWidth maxWidth="sm"><DialogTitle>Выберите персонажа</DialogTitle><DialogContent><Stack spacing={1}>{sortedCharacters.map((character) => <Button key={character.id} onClick={() => applyTemplate(character)} sx={{ justifyContent: 'flex-start', textTransform: 'none' }}><Stack direction="row" spacing={1} alignItems="center"><MiniAvatar avatarUrl={character.avatar_url} avatarScale={character.avatar_scale} label={character.name} /><Typography>{character.name}</Typography></Stack></Button>)}</Stack></DialogContent><DialogActions><Button onClick={() => setCharacterPickerTarget(null)}>Закрыть</Button></DialogActions></Dialog>
      <Dialog open={characterDialogOpen} onClose={() => setCharacterDialogOpen(false)} fullWidth maxWidth="sm"><DialogTitle>{characterDialogTarget === 'main_hero' ? 'Главный герой' : 'NPC'}</DialogTitle><DialogContent><Stack spacing={1}><input ref={characterAvatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleCharacterAvatarUpload} style={{ display: 'none' }} /><Stack direction="row" spacing={1} alignItems="center"><MiniAvatar avatarUrl={characterAvatarDraft} avatarScale={characterAvatarScaleDraft} label={characterNameDraft || 'Персонаж'} /><Stack direction="row" spacing={1}><Button onClick={() => characterAvatarInputRef.current?.click()}>Загрузить</Button><Button onClick={() => setCharacterAvatarDraft(null)}>Удалить</Button></Stack></Stack><Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem' }}>Масштаб аватара: {characterAvatarScaleDraft.toFixed(2)}x</Typography><Slider min={AVATAR_SCALE_MIN} max={AVATAR_SCALE_MAX} step={0.05} value={characterAvatarScaleDraft} onChange={(_, value) => setCharacterAvatarScaleDraft(value as number)} /><TextField label="Имя" value={characterNameDraft} onChange={(event) => setCharacterNameDraft(event.target.value)} fullWidth /><TextField label="Описание" value={characterDescriptionDraft} onChange={(event) => setCharacterDescriptionDraft(event.target.value)} fullWidth multiline minRows={3} /><TextField label="Триггеры (через запятую)" value={characterTriggersDraft} onChange={(event) => setCharacterTriggersDraft(event.target.value)} fullWidth /></Stack></DialogContent><DialogActions><Button onClick={() => setCharacterDialogOpen(false)}>Отмена</Button><Button onClick={saveCharacterDialog}>Сохранить</Button></DialogActions></Dialog>
    </Box>
  )
}

export default WorldCreatePage
