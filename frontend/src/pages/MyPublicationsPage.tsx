import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Alert, Box, Button, CircularProgress, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material'
import AppHeader from '../components/AppHeader'
import HeaderAccountActions from '../components/HeaderAccountActions'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import DeferredImage from '../components/media/DeferredImage'
import ProgressiveAvatar from '../components/media/ProgressiveAvatar'
import { useIncrementalList } from '../hooks/useIncrementalList'
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
import type {
  StoryCharacter,
  StoryGameSummary,
  StoryInstructionTemplate,
  StoryPublicationState,
  StoryPublicationStatus,
} from '../types/story'
import { buildWorldFallbackArtwork } from '../utils/worldBackground'

type MyPublicationsPageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
}

type PublicationSection = 'worlds' | 'characters' | 'instructions'
type PublicationMenuType = 'world' | 'character' | 'instruction'
type PublicationSectionState = Record<PublicationSection, boolean>

const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const COMMUNITY_PUBLIC_CARD_HERO_HEIGHT = 138
const COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS = 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))'

type PublicationCardPresentation = {
  statusLabel: string
  statusTone: PublicationChipTone
  note: string
}

type PublicationChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

function resolvePublicationChipColors(tone: PublicationChipTone): {
  borderColor: string
  textColor: string
  backgroundColor: string
} {
  if (tone === 'success') {
    return {
      borderColor: 'rgba(128, 213, 162, 0.46)',
      textColor: 'rgba(170, 238, 191, 0.96)',
      backgroundColor: 'rgba(46, 92, 66, 0.18)',
    }
  }
  if (tone === 'warning') {
    return {
      borderColor: 'rgba(232, 194, 91, 0.48)',
      textColor: 'rgba(255, 224, 126, 0.96)',
      backgroundColor: 'rgba(116, 86, 18, 0.2)',
    }
  }
  if (tone === 'danger') {
    return {
      borderColor: 'rgba(224, 116, 116, 0.5)',
      textColor: 'rgba(255, 171, 171, 0.98)',
      backgroundColor: 'rgba(110, 32, 32, 0.2)',
    }
  }
  if (tone === 'info') {
    return {
      borderColor: 'rgba(140, 188, 230, 0.44)',
      textColor: 'rgba(184, 218, 247, 0.96)',
      backgroundColor: 'rgba(38, 66, 93, 0.18)',
    }
  }
  return {
    borderColor: 'rgba(184, 199, 214, 0.32)',
    textColor: 'rgba(214, 223, 235, 0.9)',
    backgroundColor: 'rgba(45, 54, 67, 0.18)',
  }
}

function parseDate(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sortByUpdatedDesc<T extends { id: number; updated_at: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => parseDate(right.updated_at) - parseDate(left.updated_at) || right.id - left.id)
}

function normalizePublicationStatus(
  publication: StoryPublicationState | null | undefined,
  visibility: 'private' | 'public',
): StoryPublicationStatus {
  const status = publication?.status
  if (status === 'pending' || status === 'approved' || status === 'rejected') {
    return status
  }
  return visibility === 'public' ? 'approved' : 'none'
}

function shouldDisplayPublicationSource(
  publication: StoryPublicationState | null | undefined,
  visibility: 'private' | 'public',
): boolean {
  return normalizePublicationStatus(publication, visibility) !== 'none'
}

function buildPublicationCardPresentation(
  publication: StoryPublicationState | null | undefined,
  visibility: 'private' | 'public',
): PublicationCardPresentation {
  const normalizedStatus = normalizePublicationStatus(publication, visibility)
  if (normalizedStatus === 'pending') {
    return {
      statusLabel: 'На модерации',
      statusTone: 'warning',
      note: '',
    }
  }
  if (normalizedStatus === 'rejected') {
    return {
      statusLabel: 'Отклонено',
      statusTone: 'danger',
      note: (publication?.rejection_reason ?? '').trim(),
    }
  }
  if (normalizedStatus === 'approved') {
    return {
      statusLabel: 'Опубликовано',
      statusTone: 'success',
      note: '',
    }
  }
  return {
    statusLabel: visibility === 'public' ? 'Опубликовано' : 'Черновик',
    statusTone: visibility === 'public' ? 'success' : 'neutral',
    note: '',
  }
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

type PublicationEntityCardProps = {
  title: string
  description: string
  note?: string
  authorName: string
  authorAvatarUrl: string | null
  statusLabel: string
  statusTone: PublicationChipTone
  additionsCount: number
  ratingAvg: number
  heroBackgroundSx: Record<string, string | number>
  heroImageUrl?: string | null
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
    statusTone,
    additionsCount,
    ratingAvg,
    heroBackgroundSx,
    heroImageUrl,
    onClick,
    onOpenMenu,
    menuAriaLabel,
  } = props
  const normalizedAuthorName = authorName.trim() || 'Неизвестный автор'
  const authorInitials = resolveAuthorInitials(normalizedAuthorName)
  const normalizedNote = note.trim()
  const statusChipColors = resolvePublicationChipColors(statusTone)
  const noteChipColors = resolvePublicationChipColors(statusTone === 'danger' ? 'danger' : 'info')

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
        contentVisibility: 'auto',
        containIntrinsicSize: '238px',
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
          <DeferredImage src={heroImageUrl} alt="" rootMargin="300px 0px" objectFit="cover" objectPosition="center" />
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.54) 44%, rgba(0,0,0,0) 100%)',
            }}
          />
          <Stack direction="row" spacing={1} alignItems="center" sx={{ position: 'absolute', top: 10, left: 10, right: 10, minWidth: 0, pr: 4.2 }}>
            <ProgressiveAvatar
              src={authorAvatarUrl}
              alt={normalizedAuthorName}
              fallbackLabel={authorInitials}
              size={36}
              priority
              sx={{
                border: 'var(--morius-border-width) solid rgba(205, 220, 242, 0.34)',
                backgroundColor: 'rgba(6, 10, 16, 0.72)',
              }}
            />
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
                  border: `var(--morius-border-width) solid ${noteChipColors.borderColor}`,
                  color: noteChipColors.textColor,
                  backgroundColor: noteChipColors.backgroundColor,
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
            <Box
              sx={{
                px: 0.9,
                py: 0.28,
                borderRadius: '999px',
                border: `var(--morius-border-width) solid ${statusChipColors.borderColor}`,
                backgroundColor: statusChipColors.backgroundColor,
                color: statusChipColors.textColor,
                fontSize: '0.73rem',
                fontWeight: 800,
                letterSpacing: 0.18,
                textTransform: 'uppercase',
                lineHeight: 1.2,
              }}
            >
              {statusLabel}
            </Box>
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
  const [errorMessage, setErrorMessage] = useState('')
  const [publicationGames, setPublicationGames] = useState<StoryGameSummary[]>([])
  const [publicationCharacters, setPublicationCharacters] = useState<StoryCharacter[]>([])
  const [publicationTemplates, setPublicationTemplates] = useState<StoryInstructionTemplate[]>([])
  const [loadedSections, setLoadedSections] = useState<PublicationSectionState>({
    worlds: false,
    characters: false,
    instructions: false,
  })
  const [loadingSections, setLoadingSections] = useState<PublicationSectionState>({
    worlds: false,
    characters: false,
    instructions: false,
  })
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
  const {
    visibleItems: visiblePublicationGames,
    hasMore: hasMorePublicationGames,
    loadMoreRef: publicationGamesLoadMoreRef,
  } = useIncrementalList(publicationGames, { initialCount: 10, step: 10, resetKey: `worlds:${publicationGames.length}` })
  const {
    visibleItems: visiblePublicationCharacters,
    hasMore: hasMorePublicationCharacters,
    loadMoreRef: publicationCharactersLoadMoreRef,
  } = useIncrementalList(publicationCharacters, { initialCount: 10, step: 10, resetKey: `characters:${publicationCharacters.length}` })
  const {
    visibleItems: visiblePublicationTemplates,
    hasMore: hasMorePublicationTemplates,
    loadMoreRef: publicationTemplatesLoadMoreRef,
  } = useIncrementalList(publicationTemplates, { initialCount: 10, step: 10, resetKey: `instructions:${publicationTemplates.length}` })

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

  const loadPublicationWorlds = useCallback(async (options?: { force?: boolean }) => {
    const forceReload = options?.force === true
    if (loadingSections.worlds && !forceReload) {
      return
    }
    setErrorMessage('')
    setLoadingSections((previous) => ({ ...previous, worlds: true }))
    try {
      const games = await listStoryGames(authToken, { compact: true })
      setPublicationGames(
        sortByUpdatedDesc(
          games.filter(
            (item) =>
              item.source_world_id === null &&
              shouldDisplayPublicationSource(item.publication, item.visibility),
            ),
        ),
      )
      setLoadedSections((previous) => ({ ...previous, worlds: true }))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить опубликованные миры'
      setErrorMessage(detail)
      if (!loadedSections.worlds) {
        setPublicationGames([])
      }
    } finally {
      setLoadingSections((previous) => ({ ...previous, worlds: false }))
    }
  }, [authToken, loadedSections.worlds, loadingSections.worlds])

  const loadPublicationCharacters = useCallback(async (options?: { force?: boolean }) => {
    const forceReload = options?.force === true
    if (loadingSections.characters && !forceReload) {
      return
    }
    setErrorMessage('')
    setLoadingSections((previous) => ({ ...previous, characters: true }))
    try {
      const characters = await listStoryCharacters(authToken)
      setPublicationCharacters(
        sortByUpdatedDesc(
          characters.filter(
            (item) =>
              item.source_character_id === null &&
              shouldDisplayPublicationSource(item.publication, item.visibility),
          ),
        ),
      )
      setLoadedSections((previous) => ({ ...previous, characters: true }))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить опубликованных персонажей'
      setErrorMessage(detail)
      if (!loadedSections.characters) {
        setPublicationCharacters([])
      }
    } finally {
      setLoadingSections((previous) => ({ ...previous, characters: false }))
    }
  }, [authToken, loadedSections.characters, loadingSections.characters])

  const loadPublicationTemplates = useCallback(async (options?: { force?: boolean }) => {
    const forceReload = options?.force === true
    if (loadingSections.instructions && !forceReload) {
      return
    }
    setErrorMessage('')
    setLoadingSections((previous) => ({ ...previous, instructions: true }))
    try {
      const templates = await listStoryInstructionTemplates(authToken)
      setPublicationTemplates(
        sortByUpdatedDesc(
          templates.filter(
            (item) =>
              item.source_template_id === null &&
              shouldDisplayPublicationSource(item.publication, item.visibility),
          ),
        ),
      )
      setLoadedSections((previous) => ({ ...previous, instructions: true }))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить опубликованные инструкции'
      setErrorMessage(detail)
      if (!loadedSections.instructions) {
        setPublicationTemplates([])
      }
    } finally {
      setLoadingSections((previous) => ({ ...previous, instructions: false }))
    }
  }, [authToken, loadedSections.instructions, loadingSections.instructions])

  useEffect(() => {
    if (section === 'worlds' && !loadedSections.worlds && !loadingSections.worlds) {
      void loadPublicationWorlds()
      return
    }
    if (section === 'characters' && !loadedSections.characters && !loadingSections.characters) {
      void loadPublicationCharacters()
      return
    }
    if (section === 'instructions' && !loadedSections.instructions && !loadingSections.instructions) {
      void loadPublicationTemplates()
    }
  }, [
    loadPublicationCharacters,
    loadPublicationTemplates,
    loadPublicationWorlds,
    loadedSections.characters,
    loadedSections.instructions,
    loadedSections.worlds,
    loadingSections.characters,
    loadingSections.instructions,
    loadingSections.worlds,
    section,
  ])

  const isCurrentSectionLoading = loadingSections[section] && !loadedSections[section]

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
        await loadPublicationWorlds({ force: true })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось снять мир с публикации'
        setErrorMessage(detail)
      } finally {
        setActionLoading(actionKey, false)
      }
    },
    [actionLoadingByKey, authToken, loadPublicationWorlds, setActionLoading],
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
            emotion_assets: character.emotion_assets ?? {},
            emotion_model: character.emotion_model ?? null,
            emotion_prompt_lock: character.emotion_prompt_lock ?? null,
            visibility: 'private',
          },
        })
        await loadPublicationCharacters({ force: true })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось снять персонажа с публикации'
        setErrorMessage(detail)
      } finally {
        setActionLoading(actionKey, false)
      }
    },
    [actionLoadingByKey, authToken, loadPublicationCharacters, setActionLoading],
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
        await loadPublicationTemplates({ force: true })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось снять инструкцию с публикации'
        setErrorMessage(detail)
      } finally {
        setActionLoading(actionKey, false)
      }
    },
    [actionLoadingByKey, authToken, loadPublicationTemplates, setActionLoading],
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
    void loadPublicationCharacters({ force: true })
  }, [loadPublicationCharacters])

  const openInstructionEdit = useCallback((templateId: number) => {
    setInstructionDialogMode('list')
    setInstructionEditId(templateId)
    setInstructionDialogOpen(true)
  }, [])

  const closeInstructionDialog = useCallback(() => {
    setInstructionDialogOpen(false)
    setInstructionDialogMode('list')
    setInstructionEditId(null)
    void loadPublicationTemplates({ force: true })
  }, [loadPublicationTemplates])

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
      onNavigate(`/worlds/${selectedPublicationWorld.id}/edit?source=my-publications`)
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
          <HeaderAccountActions
            user={user}
            authToken={authToken}
            avatarSize={HEADER_AVATAR_SIZE}
            onOpenProfile={() => onNavigate('/profile')}
          />
        }
      />

      <Box sx={{ pt: 'var(--morius-header-menu-top)', pb: { xs: 5, md: 6 }, px: { xs: 2, md: 3.2 } }}>
        <Box sx={{ width: '100%', maxWidth: 1280, mx: 'auto' }}>
          {errorMessage ? (
            <Alert severity="error" onClose={() => setErrorMessage('')} sx={{ mb: 2, borderRadius: '12px' }}>
              {errorMessage}
            </Alert>
          ) : null}

          <Stack alignItems="center" spacing={0.8} sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: { xs: '2rem', md: '2.35rem' }, fontWeight: 900, color: APP_TEXT_PRIMARY, textAlign: 'center' }}>
              Публикации
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              <Button
                onClick={() => setSection('worlds')}
                sx={{
                  minHeight: 34,
                  px: 1.15,
                  borderRadius: '999px',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  color: section === 'worlds' ? 'var(--morius-accent)' : APP_TEXT_SECONDARY,
                  backgroundColor: section === 'worlds' ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))' : APP_CARD_BACKGROUND,
                  textTransform: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  '&:hover': { backgroundColor: section === 'worlds' ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))' : APP_BUTTON_HOVER },
                }}
              >
                Миры
              </Button>
              <Button
                onClick={() => setSection('characters')}
                sx={{
                  minHeight: 34,
                  px: 1.15,
                  borderRadius: '999px',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  color: section === 'characters' ? 'var(--morius-accent)' : APP_TEXT_SECONDARY,
                  backgroundColor: section === 'characters' ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))' : APP_CARD_BACKGROUND,
                  textTransform: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  '&:hover': { backgroundColor: section === 'characters' ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))' : APP_BUTTON_HOVER },
                }}
              >
                Персонажи
              </Button>
              <Button
                onClick={() => setSection('instructions')}
                sx={{
                  minHeight: 34,
                  px: 1.15,
                  borderRadius: '999px',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  color: section === 'instructions' ? 'var(--morius-accent)' : APP_TEXT_SECONDARY,
                  backgroundColor: section === 'instructions' ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))' : APP_CARD_BACKGROUND,
                  textTransform: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  '&:hover': { backgroundColor: section === 'instructions' ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))' : APP_BUTTON_HOVER },
                }}
              >
                Инструкции
              </Button>
            </Stack>
          </Stack>

          {isCurrentSectionLoading && (
            (section === 'worlds' && publicationGames.length === 0) ||
            (section === 'characters' && publicationCharacters.length === 0) ||
            (section === 'instructions' && publicationTemplates.length === 0)
          ) ? (
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

          {!isCurrentSectionLoading && section === 'worlds' ? (
            publicationGames.length === 0 ? (
              <Typography sx={{ color: APP_TEXT_SECONDARY }}>У вас пока нет миров на публикации.</Typography>
            ) : (
              <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS }}>
                {visiblePublicationGames.map((game) => {
                  const publicationMeta = buildPublicationCardPresentation(game.publication, game.visibility)
                  return (
                    <PublicationEntityCard
                      key={game.id}
                      title={game.title || 'Без названия'}
                      description={game.description || 'Описание отсутствует.'}
                      note={publicationMeta.note || game.genres[0] || ''}
                      authorName={authorName}
                      authorAvatarUrl={authorAvatarUrl}
                      statusLabel={publicationMeta.statusLabel}
                      statusTone={publicationMeta.statusTone}
                      additionsCount={game.community_launches}
                      ratingAvg={game.community_rating_avg}
                      heroBackgroundSx={buildWorldFallbackArtwork(game.id)}
                      heroImageUrl={game.cover_image_url}
                      onClick={() => onNavigate(`/worlds/${game.id}/edit?source=my-publications`)}
                      onOpenMenu={(event) => handleOpenCardMenu(event, 'world', game.id)}
                      menuAriaLabel="Открыть действия мира"
                    />
                  )
                })}
              </Box>
            )
          ) : null}
          {!isCurrentSectionLoading && section === 'worlds' && hasMorePublicationGames ? <Box ref={publicationGamesLoadMoreRef} sx={{ height: 2 }} /> : null}

          {!isCurrentSectionLoading && section === 'characters' ? (
            publicationCharacters.length === 0 ? (
              <Typography sx={{ color: APP_TEXT_SECONDARY }}>У вас пока нет персонажей на публикации.</Typography>
            ) : (
              <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS }}>
                {visiblePublicationCharacters.map((character) => {
                  const publicationMeta = buildPublicationCardPresentation(character.publication, character.visibility)
                  return (
                    <PublicationEntityCard
                      key={character.id}
                      title={character.name || 'Без имени'}
                      description={character.description || 'Описание отсутствует.'}
                      note={publicationMeta.note || character.note}
                      authorName={authorName}
                      authorAvatarUrl={authorAvatarUrl}
                      statusLabel={publicationMeta.statusLabel}
                      statusTone={publicationMeta.statusTone}
                      additionsCount={character.community_additions_count}
                      ratingAvg={character.community_rating_avg}
                      heroBackgroundSx={buildWorldFallbackArtwork(character.id)}
                      heroImageUrl={character.avatar_url}
                      onClick={() => openCharacterEdit(character.id)}
                      onOpenMenu={(event) => handleOpenCardMenu(event, 'character', character.id)}
                      menuAriaLabel="Открыть действия персонажа"
                    />
                  )
                })}
              </Box>
            )
          ) : null}
          {!isCurrentSectionLoading && section === 'characters' && hasMorePublicationCharacters ? <Box ref={publicationCharactersLoadMoreRef} sx={{ height: 2 }} /> : null}

          {!isCurrentSectionLoading && section === 'instructions' ? (
            publicationTemplates.length === 0 ? (
              <Typography sx={{ color: APP_TEXT_SECONDARY }}>У вас пока нет инструкций на публикации.</Typography>
            ) : (
              <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: COMMUNITY_CARD_GRID_TEMPLATE_COLUMNS }}>
                {visiblePublicationTemplates.map((template) => {
                  const publicationMeta = buildPublicationCardPresentation(template.publication, template.visibility)
                  return (
                    <PublicationEntityCard
                      key={template.id}
                      title={template.title || 'Без названия'}
                      description={template.content || 'Текст инструкции отсутствует.'}
                      note={publicationMeta.note}
                      authorName={authorName}
                      authorAvatarUrl={authorAvatarUrl}
                      statusLabel={publicationMeta.statusLabel}
                      statusTone={publicationMeta.statusTone}
                      additionsCount={template.community_additions_count}
                      ratingAvg={template.community_rating_avg}
                      heroBackgroundSx={buildWorldFallbackArtwork(template.id + 100000)}
                      onClick={() => openInstructionEdit(template.id)}
                      onOpenMenu={(event) => handleOpenCardMenu(event, 'instruction', template.id)}
                      menuAriaLabel="Открыть действия инструкции"
                    />
                  )
                })}
              </Box>
            )
          ) : null}
          {!isCurrentSectionLoading && section === 'instructions' && hasMorePublicationTemplates ? <Box ref={publicationTemplatesLoadMoreRef} sx={{ height: 2 }} /> : null}
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
            <Box component="span">Снять с публикации</Box>
          </Stack>
        </MenuItem>
      </Menu>

      <CharacterManagerDialog
        open={characterDialogOpen}
        authToken={authToken}
        initialMode={characterDialogMode}
        initialCharacterId={characterEditId}
        includePublicationCopies
        showEmotionTools={user.role === 'administrator'}
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

