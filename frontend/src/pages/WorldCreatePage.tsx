import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
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
} from '../services/storyApi'
import { moriusThemeTokens } from '../theme'
import type { AuthUser } from '../types/auth'
import type { StoryGameVisibility } from '../types/story'

type WorldCreatePageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
}

type EditableCard = {
  id: number
  title: string
  content: string
}

type EditableNpc = {
  id: number
  name: string
  description: string
  triggers: string
}

const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const APP_BUTTON_ACTIVE = 'var(--morius-button-active)'

function parseTriggersDraft(value: string, fallback: string): string[] {
  const rawItems = value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean)

  const deduped = Array.from(new Set(rawItems))
  if (deduped.length > 0) {
    return deduped
  }

  const normalizedFallback = fallback.trim()
  return normalizedFallback ? [normalizedFallback] : []
}

function UserAvatar({ user, size = HEADER_AVATAR_SIZE }: { user: AuthUser; size?: number }) {
  const fallbackLabel = user.display_name || user.email || 'U'
  const fallbackGlyph = fallbackLabel.trim().charAt(0).toUpperCase() || 'U'

  if (user.avatar_url) {
    return (
      <Box
        component="img"
        src={user.avatar_url}
        alt={fallbackLabel}
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: '1px solid rgba(186, 202, 214, 0.28)',
          objectFit: 'cover',
          backgroundColor: 'rgba(18, 22, 29, 0.7)',
        }}
      />
    )
  }

  return (
    <Box
      aria-label="Нет аватара"
      title={fallbackLabel}
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1px solid rgba(186, 202, 214, 0.28)',
        background: 'linear-gradient(180deg, rgba(39, 47, 61, 0.9), rgba(16, 20, 27, 0.95))',
        color: APP_TEXT_PRIMARY,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 800,
      }}
    >
      {fallbackGlyph}
    </Box>
  )
}

function WorldCreatePage({ user, authToken, onNavigate }: WorldCreatePageProps) {
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false)
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<StoryGameVisibility>('private')

  const [instructionCards, setInstructionCards] = useState<EditableCard[]>([{ id: 1, title: '', content: '' }])
  const [plotCards, setPlotCards] = useState<EditableCard[]>([{ id: 1, title: '', content: '' }])
  const [mainHeroName, setMainHeroName] = useState('')
  const [mainHeroDescription, setMainHeroDescription] = useState('')
  const [mainHeroTriggers, setMainHeroTriggers] = useState('')
  const [npcs, setNpcs] = useState<EditableNpc[]>([])

  const canSubmit = useMemo(() => {
    if (isSubmitting) {
      return false
    }
    if (!title.trim()) {
      return false
    }
    if (!mainHeroName.trim() || !mainHeroDescription.trim()) {
      return false
    }
    return true
  }, [isSubmitting, mainHeroDescription, mainHeroName, title])

  const handleAddInstruction = useCallback(() => {
    setInstructionCards((previous) => [...previous, { id: Date.now(), title: '', content: '' }])
  }, [])

  const handleAddPlotCard = useCallback(() => {
    setPlotCards((previous) => [...previous, { id: Date.now(), title: '', content: '' }])
  }, [])

  const handleAddNpc = useCallback(() => {
    setNpcs((previous) => [...previous, { id: Date.now(), name: '', description: '', triggers: '' }])
  }, [])

  const handleCreateWorld = useCallback(async () => {
    if (!canSubmit) {
      return
    }

    const normalizedTitle = title.trim()
    const normalizedDescription = description.trim()
    const normalizedHeroName = mainHeroName.trim()
    const normalizedHeroDescription = mainHeroDescription.trim()

    if (!normalizedTitle || !normalizedHeroName || !normalizedHeroDescription) {
      return
    }

    setErrorMessage('')
    setIsSubmitting(true)
    try {
      const game = await createStoryGame({
        token: authToken,
        title: normalizedTitle,
        description: normalizedDescription,
        visibility,
      })

      const normalizedInstructions = instructionCards
        .map((card) => ({
          title: card.title.trim(),
          content: card.content.trim(),
        }))
        .filter((card) => card.title && card.content)

      for (const card of normalizedInstructions) {
        await createStoryInstructionCard({
          token: authToken,
          gameId: game.id,
          title: card.title,
          content: card.content,
        })
      }

      const normalizedPlotCards = plotCards
        .map((card) => ({
          title: card.title.trim(),
          content: card.content.trim(),
        }))
        .filter((card) => card.title && card.content)

      for (const card of normalizedPlotCards) {
        await createStoryPlotCard({
          token: authToken,
          gameId: game.id,
          title: card.title,
          content: card.content,
        })
      }

      await createStoryWorldCard({
        token: authToken,
        gameId: game.id,
        title: normalizedHeroName,
        content: normalizedHeroDescription,
        triggers: parseTriggersDraft(mainHeroTriggers, normalizedHeroName),
        kind: 'main_hero',
      })

      const normalizedNpcs = npcs
        .map((npc) => ({
          name: npc.name.trim(),
          description: npc.description.trim(),
          triggers: parseTriggersDraft(npc.triggers, npc.name.trim()),
        }))
        .filter((npc) => npc.name && npc.description)

      for (const npc of normalizedNpcs) {
        await createStoryWorldCard({
          token: authToken,
          gameId: game.id,
          title: npc.name,
          content: npc.description,
          triggers: npc.triggers,
          kind: 'npc',
        })
      }

      onNavigate(`/home/${game.id}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось создать мир'
      setErrorMessage(detail)
    } finally {
      setIsSubmitting(false)
    }
  }, [
    authToken,
    canSubmit,
    description,
    instructionCards,
    mainHeroDescription,
    mainHeroName,
    mainHeroTriggers,
    npcs,
    onNavigate,
    plotCards,
    title,
    visibility,
  ])

  return (
    <Box
      className="morius-app-shell"
      sx={{
        minHeight: '100svh',
        color: APP_TEXT_PRIMARY,
        background: APP_PAGE_BACKGROUND,
        position: 'relative',
        overflowX: 'hidden',
      }}
    >
      <AppHeader
        isPageMenuOpen={isPageMenuOpen}
        onTogglePageMenu={() => setIsPageMenuOpen((previous) => !previous)}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: false, onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', isActive: false, onClick: () => onNavigate('/games') },
          { key: 'world-create', label: 'Создание мира', isActive: true, onClick: () => onNavigate('/worlds/new') },
        ]}
        pageMenuLabels={{
          expanded: 'Свернуть меню страниц',
          collapsed: 'Открыть меню страниц',
        }}
        isRightPanelOpen={isHeaderActionsOpen}
        onToggleRightPanel={() => setIsHeaderActionsOpen((previous) => !previous)}
        rightToggleLabels={{
          expanded: 'Скрыть кнопки шапки',
          collapsed: 'Показать кнопки шапки',
        }}
        rightActions={
          <Stack direction="row" spacing={1.2}>
            <IconButton
              aria-label="Поддержка"
              onClick={(event) => event.preventDefault()}
              sx={{
                width: 44,
                height: 44,
                borderRadius: '14px',
                border: `1px solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                '&:hover': { backgroundColor: APP_BUTTON_HOVER },
              }}
            >
              <Box component="img" src={icons.help} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
            </IconButton>
            <IconButton
              aria-label="Оформление"
              onClick={(event) => event.preventDefault()}
              sx={{
                width: 44,
                height: 44,
                borderRadius: '14px',
                border: `1px solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                '&:hover': { backgroundColor: APP_BUTTON_HOVER },
              }}
            >
              <Box component="img" src={icons.theme} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
            </IconButton>
            <Button
              variant="text"
              onClick={() => onNavigate('/games')}
              aria-label="Открыть мои игры"
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
          pt: { xs: '82px', md: '88px' },
          pb: { xs: 4, md: 6 },
          px: { xs: 2, md: 3.2 },
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 980, mx: 'auto' }}>
          {errorMessage ? (
            <Alert severity="error" onClose={() => setErrorMessage('')} sx={{ mb: 2, borderRadius: '12px' }}>
              {errorMessage}
            </Alert>
          ) : null}

          <Box
            sx={{
              borderRadius: '18px',
              border: `1px solid ${APP_BORDER_COLOR}`,
              background: APP_CARD_BACKGROUND,
              p: { xs: 1.5, md: 2.2 },
            }}
          >
            <Stack spacing={1.8}>
              <Stack spacing={0.4}>
                <Typography sx={{ fontSize: { xs: '1.55rem', md: '2rem' }, fontWeight: 800 }}>Создание мира</Typography>
                <Typography sx={{ color: APP_TEXT_SECONDARY }}>
                  Заполните базовый контекст, добавьте карточки и выберите видимость мира.
                </Typography>
              </Stack>

              <TextField
                label="1. Название мира"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                fullWidth
                required
                disabled={isSubmitting}
              />

              <TextField
                label="2. Краткое описание"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                fullWidth
                multiline
                minRows={3}
                disabled={isSubmitting}
              />

              <Divider />

              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography sx={{ fontWeight: 700 }}>3. Карточки инструкций</Typography>
                  <Button onClick={handleAddInstruction} disabled={isSubmitting} sx={{ textTransform: 'none' }}>
                    Добавить
                  </Button>
                </Stack>
                {instructionCards.map((card) => (
                  <Stack key={card.id} spacing={0.8}>
                    <TextField
                      label="Заголовок инструкции"
                      value={card.title}
                      onChange={(event) =>
                        setInstructionCards((previous) =>
                          previous.map((item) => (item.id === card.id ? { ...item, title: event.target.value } : item)),
                        )
                      }
                      fullWidth
                      disabled={isSubmitting}
                    />
                    <TextField
                      label="Текст инструкции"
                      value={card.content}
                      onChange={(event) =>
                        setInstructionCards((previous) =>
                          previous.map((item) => (item.id === card.id ? { ...item, content: event.target.value } : item)),
                        )
                      }
                      fullWidth
                      multiline
                      minRows={2}
                      disabled={isSubmitting}
                    />
                    <Button
                      onClick={() => setInstructionCards((previous) => previous.filter((item) => item.id !== card.id))}
                      disabled={isSubmitting || instructionCards.length === 1}
                      sx={{ textTransform: 'none', alignSelf: 'flex-start', color: APP_TEXT_SECONDARY }}
                    >
                      Удалить
                    </Button>
                  </Stack>
                ))}
              </Stack>

              <Divider />

              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography sx={{ fontWeight: 700 }}>4. Карточки сюжета</Typography>
                  <Button onClick={handleAddPlotCard} disabled={isSubmitting} sx={{ textTransform: 'none' }}>
                    Добавить
                  </Button>
                </Stack>
                {plotCards.map((card) => (
                  <Stack key={card.id} spacing={0.8}>
                    <TextField
                      label="Заголовок сюжетной карточки"
                      value={card.title}
                      onChange={(event) =>
                        setPlotCards((previous) =>
                          previous.map((item) => (item.id === card.id ? { ...item, title: event.target.value } : item)),
                        )
                      }
                      fullWidth
                      disabled={isSubmitting}
                    />
                    <TextField
                      label="Содержимое сюжетной карточки"
                      value={card.content}
                      onChange={(event) =>
                        setPlotCards((previous) =>
                          previous.map((item) => (item.id === card.id ? { ...item, content: event.target.value } : item)),
                        )
                      }
                      fullWidth
                      multiline
                      minRows={2}
                      disabled={isSubmitting}
                    />
                    <Button
                      onClick={() => setPlotCards((previous) => previous.filter((item) => item.id !== card.id))}
                      disabled={isSubmitting || plotCards.length === 1}
                      sx={{ textTransform: 'none', alignSelf: 'flex-start', color: APP_TEXT_SECONDARY }}
                    >
                      Удалить
                    </Button>
                  </Stack>
                ))}
              </Stack>

              <Divider />

              <Stack spacing={1}>
                <Typography sx={{ fontWeight: 700 }}>5. Главный герой</Typography>
                <TextField
                  label="Имя ГГ"
                  value={mainHeroName}
                  onChange={(event) => setMainHeroName(event.target.value)}
                  required
                  fullWidth
                  disabled={isSubmitting}
                />
                <TextField
                  label="Описание ГГ"
                  value={mainHeroDescription}
                  onChange={(event) => setMainHeroDescription(event.target.value)}
                  required
                  fullWidth
                  multiline
                  minRows={2}
                  disabled={isSubmitting}
                />
                <TextField
                  label="Триггеры ГГ (через запятую)"
                  value={mainHeroTriggers}
                  onChange={(event) => setMainHeroTriggers(event.target.value)}
                  fullWidth
                  disabled={isSubmitting}
                />
              </Stack>

              <Divider />

              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography sx={{ fontWeight: 700 }}>6. NPC</Typography>
                  <Button onClick={handleAddNpc} disabled={isSubmitting} sx={{ textTransform: 'none' }}>
                    Добавить NPC
                  </Button>
                </Stack>
                {npcs.length === 0 ? (
                  <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.92rem' }}>
                    Пока без NPC. Можно добавить позже в самой игре.
                  </Typography>
                ) : null}
                {npcs.map((npc) => (
                  <Stack key={npc.id} spacing={0.8}>
                    <TextField
                      label="Имя NPC"
                      value={npc.name}
                      onChange={(event) =>
                        setNpcs((previous) =>
                          previous.map((item) => (item.id === npc.id ? { ...item, name: event.target.value } : item)),
                        )
                      }
                      fullWidth
                      disabled={isSubmitting}
                    />
                    <TextField
                      label="Описание NPC"
                      value={npc.description}
                      onChange={(event) =>
                        setNpcs((previous) =>
                          previous.map((item) => (item.id === npc.id ? { ...item, description: event.target.value } : item)),
                        )
                      }
                      fullWidth
                      multiline
                      minRows={2}
                      disabled={isSubmitting}
                    />
                    <TextField
                      label="Триггеры NPC (через запятую)"
                      value={npc.triggers}
                      onChange={(event) =>
                        setNpcs((previous) =>
                          previous.map((item) => (item.id === npc.id ? { ...item, triggers: event.target.value } : item)),
                        )
                      }
                      fullWidth
                      disabled={isSubmitting}
                    />
                    <Button
                      onClick={() => setNpcs((previous) => previous.filter((item) => item.id !== npc.id))}
                      disabled={isSubmitting}
                      sx={{ textTransform: 'none', alignSelf: 'flex-start', color: APP_TEXT_SECONDARY }}
                    >
                      Удалить NPC
                    </Button>
                  </Stack>
                ))}
              </Stack>

              <Divider />

              <Stack spacing={0.9}>
                <Typography sx={{ fontWeight: 700 }}>7. Видимость мира</Typography>
                <Stack direction="row" spacing={1}>
                  <Button
                    onClick={() => setVisibility('private')}
                    disabled={isSubmitting}
                    sx={{
                      minHeight: 40,
                      textTransform: 'none',
                      borderRadius: '10px',
                      border: `1px solid ${APP_BORDER_COLOR}`,
                      color: APP_TEXT_PRIMARY,
                      backgroundColor: visibility === 'private' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                      '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                    }}
                  >
                    Приватный
                  </Button>
                  <Button
                    onClick={() => setVisibility('public')}
                    disabled={isSubmitting}
                    sx={{
                      minHeight: 40,
                      textTransform: 'none',
                      borderRadius: '10px',
                      border: `1px solid ${APP_BORDER_COLOR}`,
                      color: APP_TEXT_PRIMARY,
                      backgroundColor: visibility === 'public' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                      '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                    }}
                  >
                    Публичный
                  </Button>
                </Stack>
              </Stack>

              <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ pt: 0.8 }}>
                <Button
                  onClick={() => onNavigate('/games')}
                  disabled={isSubmitting}
                  sx={{
                    minHeight: 42,
                    borderRadius: '10px',
                    textTransform: 'none',
                    color: APP_TEXT_SECONDARY,
                    border: `1px solid ${APP_BORDER_COLOR}`,
                  }}
                >
                  Отмена
                </Button>
                <Button
                  onClick={() => void handleCreateWorld()}
                  disabled={!canSubmit}
                  sx={{
                    minHeight: 42,
                    borderRadius: '10px',
                    textTransform: 'none',
                    color: APP_TEXT_PRIMARY,
                    border: `1px solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_BUTTON_ACTIVE,
                    fontWeight: 700,
                    '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                  }}
                >
                  {isSubmitting ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Создать'}
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export default WorldCreatePage
