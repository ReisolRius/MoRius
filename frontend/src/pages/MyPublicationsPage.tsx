import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Alert, Box, Button, CircularProgress, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material'
import AppHeader from '../components/AppHeader'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import CommunityWorldCard from '../components/community/CommunityWorldCard'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import UserAvatar from '../components/profile/UserAvatar'
import { usePersistentPageMenuState } from '../hooks/usePersistentPageMenuState'
import {
  listStoryCharacters,
  listStoryGames,
  listStoryInstructionTemplates,
  updateStoryCharacter,
  updateStoryGameMeta,
  updateStoryInstructionTemplate,
} from '../services/storyApi'
import { moriusThemeTokens } from '../theme'
import type { AuthUser } from '../types/auth'
import type { StoryCharacter, StoryCommunityWorldSummary, StoryGameSummary, StoryInstructionTemplate } from '../types/story'
import { buildWorldFallbackArtwork } from '../utils/worldBackground'

type MyPublicationsPageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
}

type PublicationSection = 'worlds' | 'characters' | 'instructions'
type PublicationMenuType = 'world' | 'character' | 'instruction'

const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const APP_BUTTON_ACTIVE = 'var(--morius-button-active)'
const COMMUNITY_PUBLIC_CARD_HERO_HEIGHT = 138
const COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS = 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))'

function parseDate(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sortByUpdatedDesc<T extends { id: number; updated_at: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => parseDate(right.updated_at) - parseDate(left.updated_at) || right.id - left.id)
}

function resolveAuthorInitials(authorName: string): string {
  const cleaned = authorName.trim()
  if (!cleaned) {
    return '??'
  }
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0].slice(0, 1).toUpperCase()
  }
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase()
}

function mapGameToPublicationWorld(game: StoryGameSummary, user: AuthUser): StoryCommunityWorldSummary {
  const authorName = user.display_name?.trim() || 'Игрок'
  return {
    id: game.id,
    title: game.title.trim() || 'Без названия',
    description: game.description.trim() || 'Описание пока не добавлено.',
    author_id: user.id,
    author_name: authorName,
    author_avatar_url: user.avatar_url ?? null,
    age_rating: game.age_rating,
    genres: game.genres,
    cover_image_url: game.cover_image_url,
    cover_scale: game.cover_scale,
    cover_position_x: game.cover_position_x,
    cover_position_y: game.cover_position_y,
    community_views: game.community_views,
    community_launches: game.community_launches,
    community_rating_avg: game.community_rating_avg,
    community_rating_count: game.community_rating_count,
    user_rating: null,
    is_reported_by_user: false,
    is_favorited_by_user: false,
    created_at: game.created_at,
    updated_at: game.updated_at,
  }
}

type PublicationEntityCardProps = {
  title: string
  description: string
  note?: string
  authorName: string
  authorAvatarUrl: string | null
  statusLabel: string
  additionsCount: number
  ratingAvg: number
  heroBackgroundSx: Record<string, string | number>
  onClick: () => void
  onOpenMenu: (event: ReactMouseEvent<HTMLElement>) => void
  menuAriaLabel: string
}

function PublicationEntityCard(props: PublicationEntityCardProps) {
  const {
    title,
    description,
    note = '',
    authorName,
    authorAvatarUrl,
    statusLabel,
    additionsCount,
    ratingAvg,
    heroBackgroundSx,
    onClick,
    onOpenMenu,
    menuAriaLabel,
  } = props
  const normalizedAuthorName = authorName.trim() || 'Неизвестный автор'
  const authorInitials = resolveAuthorInitials(normalizedAuthorName)
  const normalizedNote = note.trim()

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      sx={{
        borderRadius: 'var(--morius-radius)',
        border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
        backgroundColor: APP_CARD_BACKGROUND,
        overflow: 'hidden',
        width: '100%',
        cursor: 'pointer',
        transition: 'transform 180ms ease, border-color 180ms ease, background-color 180ms ease',
        '&:hover': {
          borderColor: 'rgba(203, 216, 234, 0.36)',
          backgroundColor: APP_BUTTON_HOVER,
          transform: 'translateY(-2px)',
        },
        '&:focus-visible': {
          outline: '2px solid rgba(205, 223, 246, 0.62)',
          outlineOffset: '2px',
        },
        '& .publication-card-menu-trigger': {
          opacity: { xs: 1, md: 0 },
          pointerEvents: { xs: 'auto', md: 'none' },
        },
        '&:hover .publication-card-menu-trigger, &:focus-within .publication-card-menu-trigger': {
          opacity: 1,
          pointerEvents: 'auto',
        },
      }}
    >
      <Stack sx={{ minHeight: 238, justifyContent: 'space-between' }}>
        <Box sx={{ position: 'relative', height: COMMUNITY_PUBLIC_CARD_HERO_HEIGHT, overflow: 'hidden' }}>
          <Box sx={{ position: 'absolute', inset: 0, ...heroBackgroundSx }} />
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.54) 44%, rgba(0,0,0,0) 100%)',
            }}
          />
          <Stack direction="row" spacing={1} alignItems="center" sx={{ position: 'absolute', top: 10, left: 10, right: 10, minWidth: 0, pr: 4.2 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: 'var(--morius-border-width) solid rgba(205, 220, 242, 0.34)',
                overflow: 'hidden',
                display: 'grid',
                placeItems: 'center',
                backgroundColor: 'rgba(6, 10, 16, 0.72)',
                color: 'rgba(233, 241, 252, 0.97)',
                fontSize: '0.78rem',
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {authorAvatarUrl ? <Box component="img" src={authorAvatarUrl} alt={normalizedAuthorName} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : authorInitials}
            </Box>
            <Typography
              sx={{
                color: 'rgba(233, 241, 252, 0.97)',
                fontSize: '0.95rem',
                lineHeight: 1.2,
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
              title={normalizedAuthorName}
            >
              {normalizedAuthorName}
            </Typography>
          </Stack>
          <IconButton
            onClick={onOpenMenu}
            className="publication-card-menu-trigger"
            aria-label={menuAriaLabel}
            sx={{
              position: 'absolute',
              top: 10,
              right: 10,
              zIndex: 3,
              width: 32,
              height: 32,
              borderRadius: '999px',
              border: 'none',
              backgroundColor: 'rgba(5, 8, 13, 0.64)',
              color: 'rgba(220, 231, 245, 0.94)',
              transition: 'opacity 180ms ease, background-color 180ms ease',
              '&:hover': { backgroundColor: 'rgba(17, 27, 40, 0.78)' },
            }}
          >
            <Box component="span" sx={{ fontSize: '0.96rem', lineHeight: 1 }}>...</Box>
          </IconButton>
        </Box>

        <Stack sx={{ p: 1.25, flex: 1, justifyContent: 'space-between' }}>
          <Stack spacing={0.8}>
            <Typography
              sx={{
                color: APP_TEXT_PRIMARY,
                fontSize: '1.03rem',
                lineHeight: 1.2,
                fontWeight: 800,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </Typography>
            {normalizedNote ? (
              <Box
                title={normalizedNote}
                sx={{
                  width: 'fit-content',
                  maxWidth: '100%',
                  px: 0.75,
                  py: 0.2,
                  borderRadius: '999px',
                  border: 'var(--morius-border-width) solid rgba(128, 213, 162, 0.46)',
                  color: 'rgba(170, 238, 191, 0.96)',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: 0.2,
                  textTransform: 'uppercase',
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {normalizedNote}
              </Box>
            ) : null}
            <Typography
              sx={{
                color: APP_TEXT_SECONDARY,
                fontSize: '0.9rem',
                lineHeight: 1.42,
                minHeight: '4.2em',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {description}
            </Typography>
          </Stack>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.1 }}>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}>{statusLabel}</Typography>
            <Stack direction="row" spacing={1.1} alignItems="center">
              <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '0.82rem', fontWeight: 700 }}>{additionsCount} +</Typography>
              <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '0.82rem', fontWeight: 700 }}>{ratingAvg.toFixed(1)} {'\u2605'}</Typography>
            </Stack>
          </Stack>
        </Stack>
      </Stack>
    </Box>
  )
}

function MyPublicationsPage({ user, authToken, onNavigate }: MyPublicationsPageProps) {
  const [isPageMenuOpen, setIsPageMenuOpen] = usePersistentPageMenuState()
  const [section, setSection] = useState<PublicationSection>('worlds')
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [publicationGames, setPublicationGames] = useState<StoryGameSummary[]>([])
  const [publicationCharacters, setPublicationCharacters] = useState<StoryCharacter[]>([])
  const [publicationTemplates, setPublicationTemplates] = useState<StoryInstructionTemplate[]>([])
  const [actionLoadingByKey, setActionLoadingByKey] = useState<Record<string, boolean>>({})
  const [cardMenuAnchorEl, setCardMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [cardMenuType, setCardMenuType] = useState<PublicationMenuType | null>(null)
  const [cardMenuItemId, setCardMenuItemId] = useState<number | null>(null)
  const [characterDialogOpen, setCharacterDialogOpen] = useState(false)
  const [characterDialogMode, setCharacterDialogMode] = useState<'list' | 'create'>('list')
  const [characterEditId, setCharacterEditId] = useState<number | null>(null)
  const [instructionDialogOpen, setInstructionDialogOpen] = useState(false)
  const [instructionDialogMode, setInstructionDialogMode] = useState<'list' | 'create'>('list')
  const [instructionEditId, setInstructionEditId] = useState<number | null>(null)

  const setActionLoading = useCallback((key: string, value: boolean) => {
    setActionLoadingByKey((previous) => {
      if (value) {
        return { ...previous, [key]: true }
      }
      const next = { ...previous }
      delete next[key]
      return next
    })
  }, [])

  const loadPublications = useCallback(async () => {
    setErrorMessage('')
    setIsLoading(true)
    try {
      const [games, characters, templates] = await Promise.all([
        listStoryGames(authToken, { compact: true }),
        listStoryCharacters(authToken),
        listStoryInstructionTemplates(authToken),
      ])
      setPublicationGames(sortByUpdatedDesc(games.filter((item) => item.visibility === 'public')))
      setPublicationCharacters(sortByUpdatedDesc(characters.filter((item) => item.visibility === 'public')))
      setPublicationTemplates(sortByUpdatedDesc(templates.filter((item) => item.visibility === 'public')))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить публикации'
      setErrorMessage(detail)
      setPublicationGames([])
      setPublicationCharacters([])
      setPublicationTemplates([])
    } finally {
      setIsLoading(false)
    }
  }, [authToken])

  useEffect(() => {
    void loadPublications()
  }, [loadPublications])

  const handleUnpublishWorld = useCallback(
    async (game: StoryGameSummary) => {
      const actionKey = `world-${game.id}`
      if (actionLoadingByKey[actionKey]) {
        return
      }
      setActionLoading(actionKey, true)
      setErrorMessage('')
      try {
        await updateStoryGameMeta({ token: authToken, gameId: game.id, visibility: 'private' })
        await loadPublications()
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось снять мир с публикации'
        setErrorMessage(detail)
      } finally {
        setActionLoading(actionKey, false)
      }
    },
    [actionLoadingByKey, authToken, loadPublications, setActionLoading],
  )

  const handleUnpublishCharacter = useCallback(
    async (character: StoryCharacter) => {
      const actionKey = `character-${character.id}`
      if (actionLoadingByKey[actionKey]) {
        return
      }
      setActionLoading(actionKey, true)
      setErrorMessage('')
      try {
        await updateStoryCharacter({
          token: authToken,
          characterId: character.id,
          input: {
            name: character.name,
            description: character.description,
            note: character.note,
            triggers: character.triggers,
            avatar_url: character.avatar_url,
            avatar_scale: character.avatar_scale,
            visibility: 'private',
          },
        })
        await loadPublications()
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось снять персонажа с публикации'
        setErrorMessage(detail)
      } finally {
        setActionLoading(actionKey, false)
      }
    },
    [actionLoadingByKey, authToken, loadPublications, setActionLoading],
  )

  const handleUnpublishTemplate = useCallback(
    async (template: StoryInstructionTemplate) => {
      const actionKey = `template-${template.id}`
      if (actionLoadingByKey[actionKey]) {
        return
      }
      setActionLoading(actionKey, true)
      setErrorMessage('')
      try {
        await updateStoryInstructionTemplate({
          token: authToken,
          templateId: template.id,
          title: template.title,
          content: template.content,
          visibility: 'private',
        })
        await loadPublications()
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось снять инструкцию с публикации'
        setErrorMessage(detail)
      } finally {
        setActionLoading(actionKey, false)
      }
    },
    [actionLoadingByKey, authToken, loadPublications, setActionLoading],
  )

  const openCharacterEdit = useCallback((characterId: number) => {
    setCharacterDialogMode('list')
    setCharacterEditId(characterId)
    setCharacterDialogOpen(true)
  }, [])

  const closeCharacterDialog = useCallback(() => {
    setCharacterDialogOpen(false)
    setCharacterDialogMode('list')
    setCharacterEditId(null)
    void loadPublications()
  }, [loadPublications])

  const openInstructionEdit = useCallback((templateId: number) => {
    setInstructionDialogMode('list')
    setInstructionEditId(templateId)
    setInstructionDialogOpen(true)
  }, [])

  const closeInstructionDialog = useCallback(() => {
    setInstructionDialogOpen(false)
    setInstructionDialogMode('list')
    setInstructionEditId(null)
    void loadPublications()
  }, [loadPublications])

  const handleOpenCardMenu = useCallback((event: ReactMouseEvent<HTMLElement>, type: PublicationMenuType, itemId: number) => {
    event.preventDefault()
    event.stopPropagation()
    setCardMenuAnchorEl(event.currentTarget)
    setCardMenuType(type)
    setCardMenuItemId(itemId)
  }, [])

  const handleCloseCardMenu = useCallback(() => {
    setCardMenuAnchorEl(null)
    setCardMenuType(null)
    setCardMenuItemId(null)
  }, [])

  const selectedPublicationWorld = useMemo(
    () => (cardMenuType === 'world' && cardMenuItemId !== null ? publicationGames.find((item) => item.id === cardMenuItemId) ?? null : null),
    [cardMenuItemId, cardMenuType, publicationGames],
  )

  const selectedPublicationCharacter = useMemo(
    () =>
      cardMenuType === 'character' && cardMenuItemId !== null
        ? publicationCharacters.find((item) => item.id === cardMenuItemId) ?? null
        : null,
    [cardMenuItemId, cardMenuType, publicationCharacters],
  )

  const selectedPublicationTemplate = useMemo(
    () =>
      cardMenuType === 'instruction' && cardMenuItemId !== null
        ? publicationTemplates.find((item) => item.id === cardMenuItemId) ?? null
        : null,
    [cardMenuItemId, cardMenuType, publicationTemplates],
  )

  const selectedMenuActionKey = useMemo(() => {
    if (cardMenuType === 'world' && selectedPublicationWorld) {
      return `world-${selectedPublicationWorld.id}`
    }
    if (cardMenuType === 'character' && selectedPublicationCharacter) {
      return `character-${selectedPublicationCharacter.id}`
    }
    if (cardMenuType === 'instruction' && selectedPublicationTemplate) {
      return `template-${selectedPublicationTemplate.id}`
    }
    return null
  }, [cardMenuType, selectedPublicationCharacter, selectedPublicationTemplate, selectedPublicationWorld])

  const isSelectedMenuActionLoading = selectedMenuActionKey ? Boolean(actionLoadingByKey[selectedMenuActionKey]) : false

  const handleEditFromCardMenu = useCallback(() => {
    if (cardMenuType === 'world' && selectedPublicationWorld) {
      onNavigate(`/worlds/${selectedPublicationWorld.id}/edit`)
    }
    if (cardMenuType === 'character' && selectedPublicationCharacter) {
      openCharacterEdit(selectedPublicationCharacter.id)
    }
    if (cardMenuType === 'instruction' && selectedPublicationTemplate) {
      openInstructionEdit(selectedPublicationTemplate.id)
    }
    handleCloseCardMenu()
  }, [
    cardMenuType,
    handleCloseCardMenu,
    onNavigate,
    openCharacterEdit,
    openInstructionEdit,
    selectedPublicationCharacter,
    selectedPublicationTemplate,
    selectedPublicationWorld,
  ])

  const handleMakePrivateFromCardMenu = useCallback(async () => {
    const targetType = cardMenuType
    const world = selectedPublicationWorld
    const character = selectedPublicationCharacter
    const template = selectedPublicationTemplate
    handleCloseCardMenu()
    if (targetType === 'world' && world) {
      await handleUnpublishWorld(world)
      return
    }
    if (targetType === 'character' && character) {
      await handleUnpublishCharacter(character)
      return
    }
    if (targetType === 'instruction' && template) {
      await handleUnpublishTemplate(template)
    }
  }, [
    cardMenuType,
    handleCloseCardMenu,
    handleUnpublishCharacter,
    handleUnpublishTemplate,
    handleUnpublishWorld,
    selectedPublicationCharacter,
    selectedPublicationTemplate,
    selectedPublicationWorld,
  ])

  const authorName = user.display_name?.trim() || 'Игрок'
  const authorAvatarUrl = user.avatar_url ?? null

  return (
    <Box className="morius-app-shell" sx={{ minHeight: '100svh', color: APP_TEXT_PRIMARY, background: APP_PAGE_BACKGROUND, overflowX: 'hidden' }}>
      <AppHeader
        isPageMenuOpen={isPageMenuOpen}
        onTogglePageMenu={() => setIsPageMenuOpen((previous) => !previous)}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: false, onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', isActive: false, onClick: () => onNavigate('/games') },
          { key: 'games-publications', label: 'Мои публикации', isActive: true, onClick: () => onNavigate('/games/publications') },
          { key: 'games-all', label: 'Сообщество', isActive: false, onClick: () => onNavigate('/games/all') },
        ]}
        pageMenuLabels={{ expanded: 'Свернуть меню страниц', collapsed: 'Открыть меню страниц' }}
        isRightPanelOpen
        onToggleRightPanel={() => undefined}
        rightToggleLabels={{ expanded: 'Скрыть кнопки шапки', collapsed: 'Показать кнопки шапки' }}
        hideRightToggle
        onOpenTopUpDialog={() => onNavigate('/profile')}
        rightActions={
          <Button variant="text" onClick={() => onNavigate('/profile')} aria-label="Открыть профиль" sx={{ minWidth: 0, width: HEADER_AVATAR_SIZE, height: HEADER_AVATAR_SIZE, p: 0, borderRadius: '50%' }}>
            <UserAvatar user={user} size={HEADER_AVATAR_SIZE} />
          </Button>
        }
      />

      <Box sx={{ pt: 'var(--morius-header-menu-top)', pb: { xs: 5, md: 6 }, px: { xs: 2, md: 3.2 } }}>
        <Box sx={{ width: '100%', maxWidth: 1280, mx: 'auto' }}>
          {errorMessage ? (
            <Alert severity="error" onClose={() => setErrorMessage('')} sx={{ mb: 2, borderRadius: '12px' }}>
              {errorMessage}
            </Alert>
          ) : null}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.9} sx={{ mb: 2 }}>
            <Button onClick={() => setSection('worlds')} sx={{ minHeight: 40, borderRadius: '12px', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, color: APP_TEXT_PRIMARY, backgroundColor: section === 'worlds' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND, textTransform: 'none', '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>Миры</Button>
            <Button onClick={() => setSection('characters')} sx={{ minHeight: 40, borderRadius: '12px', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, color: APP_TEXT_PRIMARY, backgroundColor: section === 'characters' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND, textTransform: 'none', '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>Персонажи</Button>
            <Button onClick={() => setSection('instructions')} sx={{ minHeight: 40, borderRadius: '12px', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, color: APP_TEXT_PRIMARY, backgroundColor: section === 'instructions' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND, textTransform: 'none', '&:hover': { backgroundColor: APP_BUTTON_HOVER } }}>Инструкции</Button>
          </Stack>

          {isLoading ? (
            section === 'worlds' ? (
              <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS }}>
                {Array.from({ length: 6 }, (_, index) => (
                  <CommunityWorldCardSkeleton key={`publication-world-skeleton-${index}`} />
                ))}
              </Box>
            ) : (
              <Stack alignItems="center" sx={{ py: 8 }}>
                <CircularProgress />
              </Stack>
            )
          ) : null}

          {!isLoading && section === 'worlds' ? (
            publicationGames.length === 0 ? (
              <Typography sx={{ color: APP_TEXT_SECONDARY }}>У вас пока нет опубликованных миров.</Typography>
            ) : (
              <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS }}>
                {publicationGames.map((game) => {
                  const world = mapGameToPublicationWorld(game, user)
                  return (
                    <Box
                      key={world.id}
                      sx={{
                        position: 'relative',
                        '& .publication-card-menu-trigger': { opacity: { xs: 1, md: 0 }, pointerEvents: { xs: 'auto', md: 'none' } },
                        '&:hover .publication-card-menu-trigger, &:focus-within .publication-card-menu-trigger': { opacity: 1, pointerEvents: 'auto' },
                      }}
                    >
                      <CommunityWorldCard world={world} onAuthorClick={() => undefined} onClick={() => onNavigate(`/worlds/${game.id}/edit`)} />
                      <IconButton
                        onClick={(event) => handleOpenCardMenu(event, 'world', game.id)}
                        className="publication-card-menu-trigger"
                        aria-label="Открыть действия мира"
                        sx={{ position: 'absolute', top: 10, right: 10, zIndex: 4, width: 32, height: 32, borderRadius: '999px', border: 'none', backgroundColor: 'rgba(5, 8, 13, 0.64)', color: 'rgba(220, 231, 245, 0.94)', transition: 'opacity 180ms ease, background-color 180ms ease', '&:hover': { backgroundColor: 'rgba(17, 27, 40, 0.78)' } }}
                      >
                        <Box component="span" sx={{ fontSize: '0.96rem', lineHeight: 1 }}>...</Box>
                      </IconButton>
                    </Box>
                  )
                })}
              </Box>
            )
          ) : null}

          {!isLoading && section === 'characters' ? (
            publicationCharacters.length === 0 ? (
              <Typography sx={{ color: APP_TEXT_SECONDARY }}>У вас пока нет опубликованных персонажей.</Typography>
            ) : (
              <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS }}>
                {publicationCharacters.map((character) => (
                  <PublicationEntityCard
                    key={character.id}
                    title={character.name || 'Без имени'}
                    description={character.description || 'Описание отсутствует.'}
                    note={character.note}
                    authorName={authorName}
                    authorAvatarUrl={authorAvatarUrl}
                    statusLabel="Ваша карточка"
                    additionsCount={character.community_additions_count}
                    ratingAvg={character.community_rating_avg}
                    heroBackgroundSx={character.avatar_url ? { backgroundImage: `url(${character.avatar_url})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' } : buildWorldFallbackArtwork(character.id)}
                    onClick={() => openCharacterEdit(character.id)}
                    onOpenMenu={(event) => handleOpenCardMenu(event, 'character', character.id)}
                    menuAriaLabel="Открыть действия персонажа"
                  />
                ))}
              </Box>
            )
          ) : null}

          {!isLoading && section === 'instructions' ? (
            publicationTemplates.length === 0 ? (
              <Typography sx={{ color: APP_TEXT_SECONDARY }}>У вас пока нет опубликованных инструкций.</Typography>
            ) : (
              <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS }}>
                {publicationTemplates.map((template) => (
                  <PublicationEntityCard
                    key={template.id}
                    title={template.title || 'Без названия'}
                    description={template.content || 'Текст инструкции отсутствует.'}
                    authorName={authorName}
                    authorAvatarUrl={authorAvatarUrl}
                    statusLabel="Ваша карточка"
                    additionsCount={template.community_additions_count}
                    ratingAvg={template.community_rating_avg}
                    heroBackgroundSx={buildWorldFallbackArtwork(template.id + 100000)}
                    onClick={() => openInstructionEdit(template.id)}
                    onOpenMenu={(event) => handleOpenCardMenu(event, 'instruction', template.id)}
                    menuAriaLabel="Открыть действия инструкции"
                  />
                ))}
              </Box>
            )
          ) : null}
        </Box>
      </Box>

      <Menu
        anchorEl={cardMenuAnchorEl}
        open={Boolean(cardMenuAnchorEl && (selectedPublicationWorld || selectedPublicationCharacter || selectedPublicationTemplate))}
        onClose={handleCloseCardMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { mt: 0.5, borderRadius: '12px', border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, background: APP_CARD_BACKGROUND, minWidth: 180 } }}
      >
        <MenuItem
          onClick={handleEditFromCardMenu}
          disabled={!selectedPublicationWorld && !selectedPublicationCharacter && !selectedPublicationTemplate}
          sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center">
            <Box component="span" sx={{ fontSize: '0.92rem', lineHeight: 1 }}>...</Box>
            <Box component="span">Редактировать</Box>
          </Stack>
        </MenuItem>
        <MenuItem
          onClick={() => void handleMakePrivateFromCardMenu()}
          disabled={(!selectedPublicationWorld && !selectedPublicationCharacter && !selectedPublicationTemplate) || isSelectedMenuActionLoading}
          sx={{ color: 'rgba(248, 176, 176, 0.94)', fontSize: '0.9rem' }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center">
            {isSelectedMenuActionLoading ? <CircularProgress size={14} sx={{ color: 'rgba(248, 176, 176, 0.94)' }} /> : null}
            <Box component="span">Сделать частным</Box>
          </Stack>
        </MenuItem>
      </Menu>

      <CharacterManagerDialog
        open={characterDialogOpen}
        authToken={authToken}
        initialMode={characterDialogMode}
        initialCharacterId={characterEditId}
        includePublicationCopies
        onClose={closeCharacterDialog}
      />
      <InstructionTemplateDialog
        open={instructionDialogOpen}
        authToken={authToken}
        mode="manage"
        initialMode={instructionDialogMode}
        initialTemplateId={instructionEditId}
        includePublicationCopies
        onClose={closeInstructionDialog}
      />
    </Box>
  )
}

export default MyPublicationsPage


