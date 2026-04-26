import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Alert, Box, CircularProgress, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material'
import AppHeader from '../components/AppHeader'
import HeaderAccountActions from '../components/HeaderAccountActions'
import CharacterManagerDialog from '../components/CharacterManagerDialog'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import InstructionTemplateDialog from '../components/InstructionTemplateDialog'
import DeferredImage from '../components/media/DeferredImage'
import ProgressiveAvatar from '../components/media/ProgressiveAvatar'
import ThemedSvgIcon from '../components/icons/ThemedSvgIcon'
import cardsWorldRaw from '../assets/icons/cards-world.svg?raw'
import cardsPlotRaw from '../assets/icons/cards-plot.svg?raw'
import cardsRulesRaw from '../assets/icons/cards-rules.svg?raw'
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
import { buildUnifiedMobileQuickActions } from '../utils/mobileQuickActions'
import Footer from '../components/Footer'

type MyPublicationsPageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
}

type PublicationSection = 'worlds' | 'characters' | 'instructions'
type PublicationMenuType = 'world' | 'character' | 'instruction'
type PublicationSectionState = Record<PublicationSection, boolean>
type PublicationDisplayState = StoryPublicationState & { status: StoryPublicationStatus }

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

function selectVisiblePublicationItems<
  T extends {
    id: number
    visibility: 'private' | 'public'
    publication: StoryPublicationState
    updated_at: string
  },
>(
  items: T[],
  getSourceId: (item: T) => number | null,
): {
  visibleItems: T[]
  publicationCopySourceIds: number[]
} {
  const ownItemIds = new Set(items.map((item) => item.id))
  const publicationCopySourceIds = Array.from(
    new Set(
      items
        .map(getSourceId)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0),
    ),
  )
  const publicationCopySourceIdSet = new Set(publicationCopySourceIds)

  const visibleCandidates = sortByUpdatedDesc(
    items.filter((item) => {
      const sourceId = getSourceId(item)
      if (sourceId === null) {
        return resolvePublicationDisplayState(
          item.publication,
          item.visibility,
          publicationCopySourceIdSet.has(item.id),
        ).status !== 'none'
      }
      if (item.visibility !== 'public') {
        return false
      }
      return !ownItemIds.has(sourceId)
    }),
  )

  const visibleItemsByEntityId = new Map<number, T>()
  visibleCandidates.forEach((item) => {
    const entityId = getSourceId(item) ?? item.id
    const existingItem = visibleItemsByEntityId.get(entityId)
    if (!existingItem) {
      visibleItemsByEntityId.set(entityId, item)
      return
    }
    if (getSourceId(existingItem) !== null && getSourceId(item) === null) {
      visibleItemsByEntityId.set(entityId, item)
    }
  })

  const visibleItems = Array.from(visibleItemsByEntityId.values())

  return {
    visibleItems,
    publicationCopySourceIds,
  }
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

function resolvePublicationDisplayState(
  publication: StoryPublicationState | null | undefined,
  visibility: 'private' | 'public',
  hasPublicCopy: boolean,
): PublicationDisplayState {
  const normalizedStatus = normalizePublicationStatus(publication, visibility)
  if (normalizedStatus !== 'none') {
    return {
      status: normalizedStatus,
      requested_at: publication?.requested_at ?? null,
      reviewed_at: publication?.reviewed_at ?? null,
      reviewer_user_id: publication?.reviewer_user_id ?? null,
      rejection_reason: publication?.rejection_reason ?? null,
    }
  }
  if (visibility === 'public' || hasPublicCopy) {
    return {
      status: 'approved',
      requested_at: publication?.requested_at ?? null,
      reviewed_at: publication?.reviewed_at ?? null,
      reviewer_user_id: publication?.reviewer_user_id ?? null,
      rejection_reason: null,
    }
  }
  return {
    status: 'none',
    requested_at: publication?.requested_at ?? null,
    reviewed_at: publication?.reviewed_at ?? null,
    reviewer_user_id: publication?.reviewer_user_id ?? null,
    rejection_reason: publication?.rejection_reason ?? null,
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
  const [publicationWorldCopySourceIds, setPublicationWorldCopySourceIds] = useState<number[]>([])
  const [publicationCharacterCopySourceIds, setPublicationCharacterCopySourceIds] = useState<number[]>([])
  const [publicationTemplateCopySourceIds, setPublicationTemplateCopySourceIds] = useState<number[]>([])
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
  } = useIncrementalList(publicationGames, { initialCount: 12, step: 12, resetKey: `worlds:${publicationGames.length}` })
  const {
    visibleItems: visiblePublicationCharacters,
    hasMore: hasMorePublicationCharacters,
    loadMoreRef: publicationCharactersLoadMoreRef,
  } = useIncrementalList(publicationCharacters, { initialCount: 12, step: 12, resetKey: `characters:${publicationCharacters.length}` })
  const {
    visibleItems: visiblePublicationTemplates,
    hasMore: hasMorePublicationTemplates,
    loadMoreRef: publicationTemplatesLoadMoreRef,
  } = useIncrementalList(publicationTemplates, { initialCount: 12, step: 12, resetKey: `instructions:${publicationTemplates.length}` })

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
      const { visibleItems, publicationCopySourceIds } = selectVisiblePublicationItems(
        games,
        (item) => item.source_world_id,
      )
      setPublicationWorldCopySourceIds(publicationCopySourceIds)
      setPublicationGames(visibleItems)
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
      const { visibleItems, publicationCopySourceIds } = selectVisiblePublicationItems(
        characters,
        (item) => item.source_character_id,
      )
      setPublicationCharacterCopySourceIds(publicationCopySourceIds)
      setPublicationCharacters(visibleItems)
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
      const { visibleItems, publicationCopySourceIds } = selectVisiblePublicationItems(
        templates,
        (item) => item.source_template_id,
      )
      setPublicationTemplateCopySourceIds(publicationCopySourceIds)
      setPublicationTemplates(visibleItems)
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
      const targetGameId = game.source_world_id ?? game.id
      const actionKey = `world-${targetGameId}`
      if (actionLoadingByKey[actionKey]) {
        return
      }
      setActionLoading(actionKey, true)
      setErrorMessage('')
      try {
        await updateStoryGameMeta({ token: authToken, gameId: targetGameId, visibility: 'private' })
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
      const targetCharacterId = character.source_character_id ?? character.id
      const actionKey = `character-${targetCharacterId}`
      if (actionLoadingByKey[actionKey]) {
        return
      }
      setActionLoading(actionKey, true)
      setErrorMessage('')
      try {
        await updateStoryCharacter({
          token: authToken,
          characterId: targetCharacterId,
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
      const targetTemplateId = template.source_template_id ?? template.id
      const actionKey = `template-${targetTemplateId}`
      if (actionLoadingByKey[actionKey]) {
        return
      }
      setActionLoading(actionKey, true)
      setErrorMessage('')
      try {
        await updateStoryInstructionTemplate({
          token: authToken,
          templateId: targetTemplateId,
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
      return `world-${selectedPublicationWorld.source_world_id ?? selectedPublicationWorld.id}`
    }
    if (cardMenuType === 'character' && selectedPublicationCharacter) {
      return `character-${selectedPublicationCharacter.source_character_id ?? selectedPublicationCharacter.id}`
    }
    if (cardMenuType === 'instruction' && selectedPublicationTemplate) {
      return `template-${selectedPublicationTemplate.source_template_id ?? selectedPublicationTemplate.id}`
    }
    return null
  }, [cardMenuType, selectedPublicationCharacter, selectedPublicationTemplate, selectedPublicationWorld])

  const isSelectedMenuActionLoading = selectedMenuActionKey ? Boolean(actionLoadingByKey[selectedMenuActionKey]) : false

  const handleEditFromCardMenu = useCallback(() => {
    if (cardMenuType === 'world' && selectedPublicationWorld) {
      onNavigate(`/worlds/${selectedPublicationWorld.source_world_id ?? selectedPublicationWorld.id}/edit?source=my-publications`)
    }
    if (cardMenuType === 'character' && selectedPublicationCharacter) {
      openCharacterEdit(selectedPublicationCharacter.source_character_id ?? selectedPublicationCharacter.id)
    }
    if (cardMenuType === 'instruction' && selectedPublicationTemplate) {
      openInstructionEdit(selectedPublicationTemplate.source_template_id ?? selectedPublicationTemplate.id)
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
        onClosePageMenu={() => setIsPageMenuOpen(false)}
        mobileActionItems={buildUnifiedMobileQuickActions({
          onContinue: () => onNavigate('/dashboard?mobileAction=continue'),
          onQuickStart: () => onNavigate('/dashboard?mobileAction=quick-start'),
          onCreateWorld: () => onNavigate('/worlds/new'),
          onOpenShop: () => onNavigate('/profile?mobileAction=shop'),
        })}
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
        onOpenTopUpDialog={() => onNavigate('/profile?mobileAction=shop')}
        rightActions={
          <HeaderAccountActions
            user={user}
            authToken={authToken}
            avatarSize={HEADER_AVATAR_SIZE}
            onOpenProfile={() => onNavigate('/profile')}
          />
        }
      />

      <Box sx={{ pt: 'var(--morius-header-menu-top)', pb: { xs: 'calc(88px + env(safe-area-inset-bottom))', md: 6 }, px: { xs: 2, md: 3.2 } }}>
        <Box sx={{ width: '100%', maxWidth: 1400, mx: 'auto' }}>
          {errorMessage ? (
            <Alert severity="error" onClose={() => setErrorMessage('')} sx={{ mb: 2, borderRadius: '12px' }}>
              {errorMessage}
            </Alert>
          ) : null}

          <Stack alignItems="center" spacing={0.8} sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: { xs: '2rem', md: '2.35rem' }, fontWeight: 900, color: APP_TEXT_PRIMARY, textAlign: 'center' }}>
              Публикации
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {([
                { key: 'worlds', label: 'Миры', icon: cardsWorldRaw },
                { key: 'characters', label: 'Персонажи', icon: cardsPlotRaw },
                { key: 'instructions', label: 'Инструкции', icon: cardsRulesRaw },
              ] as const).map(({ key, label, icon }) => {
                const isActive = section === key
                return (
                  <Box
                    key={key}
                    component="button"
                    type="button"
                    onClick={() => setSection(key as PublicationSection)}
                    aria-pressed={isActive}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      height: '38px',
                      px: '16px',
                      borderRadius: '48px',
                      fontSize: '16px',
                      fontWeight: 700,
                      fontFamily: 'inherit',
                      lineHeight: 1,
                      border: 'none',
                      outline: 'none',
                      cursor: 'pointer',
                      userSelect: 'none',
                      backgroundColor: 'var(--morius-elevated-bg)',
                      color: isActive ? 'var(--morius-title-text)' : APP_TEXT_SECONDARY,
                      boxShadow: isActive ? '0 0 24px color-mix(in srgb, var(--morius-accent) 50%, transparent)' : 'none',
                      transition: 'box-shadow 250ms ease, color 200ms ease',
                      '&:hover': { color: 'var(--morius-title-text)' },
                      '&:focus-visible': { outline: '2px solid rgba(205, 223, 246, 0.56)', outlineOffset: '2px' },
                    }}
                  >
                    <ThemedSvgIcon markup={icon} size={13} sx={{ flexShrink: 0, color: 'inherit' }} />
                    {label}
                  </Box>
                )
              })}
            </Box>
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
                  const publicationState = resolvePublicationDisplayState(
                    game.publication,
                    game.visibility,
                    publicationWorldCopySourceIds.includes(game.id),
                  )
                  const publicationMeta = buildPublicationCardPresentation(publicationState, game.visibility)
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
                      onClick={() => onNavigate(`/worlds/${game.source_world_id ?? game.id}/edit?source=my-publications`)}
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
                  const publicationState = resolvePublicationDisplayState(
                    character.publication,
                    character.visibility,
                    publicationCharacterCopySourceIds.includes(character.id),
                  )
                  const publicationMeta = buildPublicationCardPresentation(publicationState, character.visibility)
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
                      onClick={() => openCharacterEdit(character.source_character_id ?? character.id)}
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
                  const publicationState = resolvePublicationDisplayState(
                    template.publication,
                    template.visibility,
                    publicationTemplateCopySourceIds.includes(template.id),
                  )
                  const publicationMeta = buildPublicationCardPresentation(publicationState, template.visibility)
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
                      onClick={() => openInstructionEdit(template.source_template_id ?? template.id)}
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

      <Footer
        socialLinks={[
          { label: 'Вконтакте', href: 'https://vk.com/moriusai', external: true },
          { label: 'Телега', href: 'https://t.me/+t2ueY4x_KvE4ZWEy', external: true },
        ]}
        infoLinks={[
          { label: 'Политика конфиденциальности', path: '/privacy-policy' },
          { label: 'Пользовательское соглашение', path: '/terms-of-service' },
        ]}
        onNavigate={onNavigate}
      />
    </Box>
  )
}

export default MyPublicationsPage

