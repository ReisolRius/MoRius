import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import AppHeader from '../components/AppHeader'
import AvatarCropDialog from '../components/AvatarCropDialog'
import CommunityWorldCard from '../components/community/CommunityWorldCard'
import CommunityWorldCardSkeleton from '../components/community/CommunityWorldCardSkeleton'
import CommunityWorldDialog from '../components/community/CommunityWorldDialog'
import ConfirmLogoutDialog from '../components/profile/ConfirmLogoutDialog'
import ProfileDialog from '../components/profile/ProfileDialog'
import UserAvatar from '../components/profile/UserAvatar'
import { updateCurrentUserAvatar, updateCurrentUserProfile } from '../services/authApi'
import {
  deleteStoryGame,
  favoriteCommunityWorld,
  getCommunityWorld,
  launchCommunityWorld,
  listCommunityWorlds,
  listStoryGames,
  rateCommunityWorld,
  reportCommunityWorld,
  unfavoriteCommunityWorld,
  type StoryCommunityWorldReportReason,
} from '../services/storyApi'
import type { AuthUser } from '../types/auth'
import type { StoryCommunityWorldPayload, StoryCommunityWorldSummary, StoryGameSummary } from '../types/story'

type CommunityWorldsPageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
}

const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const HEADER_AVATAR_SIZE = 44
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const COMMUNITY_WORLD_SKELETON_CARD_KEYS = Array.from({ length: 9 }, (_, index) => `community-world-skeleton-${index}`)

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

function parseSharedWorldIdFromLocation(search: string): number | null {
  const params = new URLSearchParams(search)
  const rawValue = params.get('worldId') ?? params.get('worldid')
  if (!rawValue) {
    return null
  }
  const parsedValue = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null
  }
  return parsedValue
}

function CommunityWorldsPage({ user, authToken, onNavigate, onUserUpdate, onLogout }: CommunityWorldsPageProps) {
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false)
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)
  const [isAvatarSaving, setIsAvatarSaving] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null)
  const [communityWorlds, setCommunityWorlds] = useState<StoryCommunityWorldSummary[]>([])
  const [isCommunityWorldsLoading, setIsCommunityWorldsLoading] = useState(false)
  const [communityWorldsError, setCommunityWorldsError] = useState('')
  const [actionError, setActionError] = useState('')
  const [selectedCommunityWorld, setSelectedCommunityWorld] = useState<StoryCommunityWorldPayload | null>(null)
  const [isCommunityWorldDialogLoading, setIsCommunityWorldDialogLoading] = useState(false)
  const [communityRatingDraft, setCommunityRatingDraft] = useState(0)
  const [isCommunityRatingSaving, setIsCommunityRatingSaving] = useState(false)
  const [isLaunchingCommunityWorld, setIsLaunchingCommunityWorld] = useState(false)
  const [communityWorldGameIds, setCommunityWorldGameIds] = useState<Record<number, number[]>>({})
  const [isCommunityWorldMyGamesSaving, setIsCommunityWorldMyGamesSaving] = useState(false)
  const [isCommunityReportSubmitting, setIsCommunityReportSubmitting] = useState(false)
  const [favoriteWorldActionById, setFavoriteWorldActionById] = useState<Record<number, boolean>>({})
  const [sharedWorldIdFromLink] = useState<number | null>(() =>
    typeof window === 'undefined' ? null : parseSharedWorldIdFromLocation(window.location.search),
  )
  const [hasAttemptedSharedWorldOpen, setHasAttemptedSharedWorldOpen] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  const loadCommunityWorlds = useCallback(async () => {
    setIsCommunityWorldsLoading(true)
    setCommunityWorldsError('')
    try {
      const worlds = await listCommunityWorlds(authToken)
      setCommunityWorlds(worlds)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить комьюнити миры'
      setCommunityWorldsError(detail)
      setCommunityWorlds([])
    } finally {
      setIsCommunityWorldsLoading(false)
    }
  }, [authToken])

  useEffect(() => {
    void loadCommunityWorlds()
  }, [loadCommunityWorlds])

  const syncCommunityWorldGameIds = useCallback(async () => {
    try {
      const games = await listStoryGames(authToken)
      setCommunityWorldGameIds(buildCommunityWorldGameMap(games))
    } catch {
      // Optional data for dialog button state; ignore failures.
    }
  }, [authToken])

  useEffect(() => {
    void syncCommunityWorldGameIds()
  }, [syncCommunityWorldGameIds])

  const handleOpenCommunityWorld = useCallback(
    async (worldId: number) => {
      if (isCommunityWorldDialogLoading) {
        return
      }
      setActionError('')
      setIsCommunityWorldDialogLoading(true)
      try {
        const payload = await getCommunityWorld({
          token: authToken,
          worldId,
        })
        setSelectedCommunityWorld(payload)
        setCommunityRatingDraft(payload.world.user_rating ?? 0)
        setCommunityWorlds((previous) =>
          previous.map((world) => (world.id === payload.world.id ? payload.world : world)),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось открыть мир'
        setActionError(detail)
      } finally {
        setIsCommunityWorldDialogLoading(false)
      }
    },
    [authToken, isCommunityWorldDialogLoading],
  )

  useEffect(() => {
    if (hasAttemptedSharedWorldOpen || sharedWorldIdFromLink === null || isCommunityWorldDialogLoading) {
      return
    }
    setHasAttemptedSharedWorldOpen(true)
    void handleOpenCommunityWorld(sharedWorldIdFromLink)
  }, [handleOpenCommunityWorld, hasAttemptedSharedWorldOpen, isCommunityWorldDialogLoading, sharedWorldIdFromLink])

  const handleCloseCommunityWorldDialog = useCallback(() => {
    if (
      isCommunityWorldDialogLoading ||
      isLaunchingCommunityWorld ||
      isCommunityRatingSaving ||
      isCommunityWorldMyGamesSaving ||
      isCommunityReportSubmitting
    ) {
      return
    }
    setSelectedCommunityWorld(null)
    setCommunityRatingDraft(0)
  }, [isCommunityRatingSaving, isCommunityReportSubmitting, isCommunityWorldDialogLoading, isCommunityWorldMyGamesSaving, isLaunchingCommunityWorld])

  const handleRateCommunityWorld = useCallback(async (ratingValue: number) => {
    if (!selectedCommunityWorld || ratingValue < 1 || ratingValue > 5 || isCommunityRatingSaving) {
      return
    }
    setCommunityRatingDraft(ratingValue)
    setActionError('')
    setIsCommunityRatingSaving(true)
    try {
      const updatedWorld = await rateCommunityWorld({
        token: authToken,
        worldId: selectedCommunityWorld.world.id,
        rating: ratingValue,
      })
      setSelectedCommunityWorld((previous) => (previous ? { ...previous, world: updatedWorld } : previous))
      setCommunityWorlds((previous) => previous.map((world) => (world.id === updatedWorld.id ? updatedWorld : world)))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить рейтинг'
      setActionError(detail)
    } finally {
      setIsCommunityRatingSaving(false)
    }
  }, [authToken, isCommunityRatingSaving, selectedCommunityWorld])

  const handleReportCommunityWorld = useCallback(
    async (payload: { reason: StoryCommunityWorldReportReason; description: string }) => {
      if (!selectedCommunityWorld || isCommunityReportSubmitting) {
        return
      }
      setActionError('')
      setIsCommunityReportSubmitting(true)
      try {
        const updatedWorld = await reportCommunityWorld({
          token: authToken,
          worldId: selectedCommunityWorld.world.id,
          reason: payload.reason,
          description: payload.description,
        })
        setSelectedCommunityWorld((previous) => (previous ? { ...previous, world: updatedWorld } : previous))
        setCommunityWorlds((previous) => previous.map((world) => (world.id === updatedWorld.id ? updatedWorld : world)))
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось отправить жалобу'
        setActionError(detail)
        throw error
      } finally {
        setIsCommunityReportSubmitting(false)
      }
    },
    [authToken, isCommunityReportSubmitting, selectedCommunityWorld],
  )

  const handleToggleFavoriteWorld = useCallback(
    async (world: StoryCommunityWorldSummary) => {
      if (favoriteWorldActionById[world.id]) {
        return
      }

      setFavoriteWorldActionById((previous) => ({
        ...previous,
        [world.id]: true,
      }))
      setActionError('')
      try {
        const updatedWorld = world.is_favorited_by_user
          ? await unfavoriteCommunityWorld({
              token: authToken,
              worldId: world.id,
            })
          : await favoriteCommunityWorld({
              token: authToken,
              worldId: world.id,
            })

        setCommunityWorlds((previous) => previous.map((item) => (item.id === updatedWorld.id ? updatedWorld : item)))
        setSelectedCommunityWorld((previous) => (previous && previous.world.id === updatedWorld.id ? { ...previous, world: updatedWorld } : previous))
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось обновить любимые миры'
        setActionError(detail)
      } finally {
        setFavoriteWorldActionById((previous) => {
          const next = { ...previous }
          delete next[world.id]
          return next
        })
      }
    },
    [authToken, favoriteWorldActionById],
  )

  const handleLaunchCommunityWorld = useCallback(async () => {
    if (!selectedCommunityWorld || isLaunchingCommunityWorld) {
      return
    }
    const worldId = selectedCommunityWorld.world.id
    setActionError('')
    setIsLaunchingCommunityWorld(true)
    try {
      const game = await launchCommunityWorld({
        token: authToken,
        worldId,
      })
      setCommunityWorldGameIds((previous) => {
        const nextIds = [...new Set([...(previous[worldId] ?? []), game.id])]
        return {
          ...previous,
          [worldId]: nextIds,
        }
      })
      onNavigate(`/home/${game.id}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось запустить мир'
      setActionError(detail)
    } finally {
      setIsLaunchingCommunityWorld(false)
    }
  }, [authToken, isLaunchingCommunityWorld, onNavigate, selectedCommunityWorld])

  const profileName = user.display_name || 'Игрок'

  const handleToggleCommunityWorldInMyGames = useCallback(async () => {
    if (!selectedCommunityWorld || isCommunityWorldMyGamesSaving || isLaunchingCommunityWorld) {
      return
    }

    const worldId = selectedCommunityWorld.world.id
    const existingGameIds = communityWorldGameIds[worldId] ?? []
    setActionError('')
    setIsCommunityWorldMyGamesSaving(true)
    try {
      if (existingGameIds.length > 0) {
        await Promise.all(
          existingGameIds.map((gameId) =>
            deleteStoryGame({
              token: authToken,
              gameId,
            }),
          ),
        )
        setCommunityWorldGameIds((previous) => {
          const nextMap = { ...previous }
          delete nextMap[worldId]
          return nextMap
        })
        return
      }

      const game = await launchCommunityWorld({
        token: authToken,
        worldId,
      })
      setCommunityWorldGameIds((previous) => ({
        ...previous,
        [worldId]: [...new Set([...(previous[worldId] ?? []), game.id])],
      }))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ СЃРїРёСЃРѕРє "РњРѕРё РёРіСЂС‹"'
      setActionError(detail)
    } finally {
      setIsCommunityWorldMyGamesSaving(false)
    }
  }, [authToken, communityWorldGameIds, isCommunityWorldMyGamesSaving, isLaunchingCommunityWorld, selectedCommunityWorld])

  const handleCloseProfileDialog = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
    setAvatarCropSource(null)
    setAvatarError('')
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

  const handleConfirmLogout = () => {
    setConfirmLogoutOpen(false)
    setProfileDialogOpen(false)
    onLogout()
  }

  const selectedCommunityWorldGameIds = selectedCommunityWorld ? communityWorldGameIds[selectedCommunityWorld.world.id] ?? [] : []
  const isSelectedCommunityWorldInMyGames = selectedCommunityWorldGameIds.length > 0

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
          { key: 'dashboard', label: 'Главная', onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', onClick: () => onNavigate('/games') },
          { key: 'community-worlds', label: 'Комьюнити миры', isActive: true, onClick: () => onNavigate('/games/all') },
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
        onOpenTopUpDialog={() => onNavigate('/profile')}
        hideRightToggle
        rightActions={
          <Stack direction="row" spacing={0}>
            <Button
              variant="text"
              onClick={() => onNavigate('/profile')}
              aria-label="Открыть профиль"
              sx={{
                minWidth: 0,
                width: HEADER_AVATAR_SIZE,
                height: HEADER_AVATAR_SIZE,
                p: 0,
                borderRadius: '50%',
                overflow: 'hidden',
                backgroundColor: 'transparent',
                '&:hover': {
                  backgroundColor: 'transparent',
                },
              }}
            >
              <UserAvatar user={user} size={HEADER_AVATAR_SIZE} />
            </Button>
          </Stack>
        }
      />

      <Box
        sx={{
          pt: 'var(--morius-header-menu-top)',
          pb: { xs: 5, md: 6 },
          px: { xs: 2, md: 3.2 },
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 1280, mx: 'auto' }}>
          {actionError ? (
            <Alert severity="error" onClose={() => setActionError('')} sx={{ mb: 2.2, borderRadius: '12px' }}>
              {actionError}
            </Alert>
          ) : null}

          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', md: 'flex-end' }}
            spacing={1}
            sx={{ mb: 1.35 }}
          >
            <Stack spacing={0.45}>
              <Typography sx={{ fontSize: { xs: '1.6rem', md: '1.9rem' }, fontWeight: 800, color: APP_TEXT_PRIMARY }}>
                Комьюнити миры
              </Typography>
              <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1.01rem' }}>
                Публичные миры игроков. Откройте карточку мира, оцените и запускайте в свои игры.
              </Typography>
            </Stack>
            <Button
              onClick={() => void loadCommunityWorlds()}
              disabled={isCommunityWorldsLoading}
              sx={{
                minHeight: 38,
                px: 1.35,
                borderRadius: 'var(--morius-radius)',
                textTransform: 'none',
                fontWeight: 700,
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                color: APP_TEXT_PRIMARY,
                '&:hover': {
                  backgroundColor: APP_BUTTON_HOVER,
                },
              }}
            >
              Обновить
            </Button>
          </Stack>

          {communityWorldsError ? (
            <Alert severity="error" sx={{ mb: 1.4, borderRadius: '12px' }}>
              {communityWorldsError}
            </Alert>
          ) : null}

          {isCommunityWorldsLoading ? (
            <Box
              sx={{
                display: 'grid',
                gap: 1.4,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  xl: 'repeat(3, minmax(0, 1fr))',
                },
              }}
            >
              {COMMUNITY_WORLD_SKELETON_CARD_KEYS.map((cardKey) => (
                <CommunityWorldCardSkeleton key={cardKey} showFavoriteButton />
              ))}
            </Box>
          ) : communityWorlds.length === 0 ? (
            <Box
              sx={{
                borderRadius: 'var(--morius-radius)',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                background: APP_CARD_BACKGROUND,
                p: 1.4,
              }}
            >
              <Typography sx={{ color: APP_TEXT_SECONDARY }}>Пока нет публичных миров от игроков.</Typography>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: 1.4,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  xl: 'repeat(3, minmax(0, 1fr))',
                },
              }}
            >
              {communityWorlds.map((world) => (
                <CommunityWorldCard
                  key={world.id}
                  world={world}
                  onClick={() => void handleOpenCommunityWorld(world.id)}
                  onAuthorClick={(authorId) => onNavigate(`/profile/${authorId}`)}
                  disabled={isCommunityWorldDialogLoading}
                  showFavoriteButton
                  isFavoriteSaving={Boolean(favoriteWorldActionById[world.id])}
                  onToggleFavorite={(item) => void handleToggleFavoriteWorld(item)}
                />
              ))}
            </Box>
          )}
        </Box>
      </Box>

      <CommunityWorldDialog
        open={Boolean(selectedCommunityWorld) || isCommunityWorldDialogLoading}
        isLoading={isCommunityWorldDialogLoading}
        worldPayload={selectedCommunityWorld}
        ratingDraft={communityRatingDraft}
        isRatingSaving={isCommunityRatingSaving}
        isLaunching={isLaunchingCommunityWorld}
        isInMyGames={isSelectedCommunityWorldInMyGames}
        isMyGamesToggleSaving={isCommunityWorldMyGamesSaving}
        onClose={handleCloseCommunityWorldDialog}
        onPlay={() => void handleLaunchCommunityWorld()}
        onRate={(value) => void handleRateCommunityWorld(value)}
        onToggleMyGames={() => void handleToggleCommunityWorldInMyGames()}
        onAuthorClick={(authorId) => {
          setSelectedCommunityWorld(null)
          onNavigate(`/profile/${authorId}`)
        }}
        onSubmitReport={(payload) => handleReportCommunityWorld(payload)}
        isReportSubmitting={isCommunityReportSubmitting}
      />
      <ProfileDialog
        open={profileDialogOpen}
        user={user}
        authToken={authToken}
        profileName={profileName}
        avatarInputRef={avatarInputRef}
        avatarError={avatarError}
        isAvatarSaving={isAvatarSaving}
        onClose={handleCloseProfileDialog}
        onChooseAvatar={handleChooseAvatar}
        onAvatarChange={handleAvatarChange}
        onOpenTopUp={() => onNavigate('/dashboard')}
        onOpenCharacterManager={() => onNavigate('/dashboard')}
        onOpenInstructionTemplates={() => onNavigate('/dashboard')}
        onRequestLogout={() => setConfirmLogoutOpen(true)}
        onUpdateProfileName={handleUpdateProfileName}
      />
      <ConfirmLogoutDialog
        open={confirmLogoutOpen}
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
    </Box>
  )
}

function buildCommunityWorldGameMap(games: StoryGameSummary[]): Record<number, number[]> {
  const nextMap: Record<number, number[]> = {}
  games.forEach((game) => {
    if (!game.source_world_id || game.source_world_id <= 0) {
      return
    }
    const worldId = game.source_world_id
    const currentIds = nextMap[worldId] ?? []
    currentIds.push(game.id)
    nextMap[worldId] = currentIds
  })
  return nextMap
}

export default CommunityWorldsPage

