import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, IconButton, Stack, Typography } from '@mui/material'
import { icons } from '../assets'
import AppHeader from '../components/AppHeader'
import CommunityWorldDialog from '../components/community/CommunityWorldDialog'
import { getCommunityWorld, launchCommunityWorld, listCommunityWorlds, rateCommunityWorld } from '../services/storyApi'
import type { AuthUser } from '../types/auth'
import type { StoryCommunityWorldPayload, StoryCommunityWorldSummary } from '../types/story'

type CommunityWorldsPageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
  onLogout: () => void
}

const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const HEADER_AVATAR_SIZE = 44

function toStarLabel(value: number): string {
  const safeValue = Math.max(0, Math.min(5, Math.round(value)))
  return '★'.repeat(safeValue) + '☆'.repeat(5 - safeValue)
}

function CommunityWorldsPage({ user, authToken, onNavigate, onLogout: _onLogout }: CommunityWorldsPageProps) {
  void _onLogout
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false)
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
  const [communityWorlds, setCommunityWorlds] = useState<StoryCommunityWorldSummary[]>([])
  const [isCommunityWorldsLoading, setIsCommunityWorldsLoading] = useState(false)
  const [communityWorldsError, setCommunityWorldsError] = useState('')
  const [actionError, setActionError] = useState('')
  const [selectedCommunityWorld, setSelectedCommunityWorld] = useState<StoryCommunityWorldPayload | null>(null)
  const [isCommunityWorldDialogLoading, setIsCommunityWorldDialogLoading] = useState(false)
  const [communityRatingDraft, setCommunityRatingDraft] = useState(0)
  const [isCommunityRatingSaving, setIsCommunityRatingSaving] = useState(false)
  const [isLaunchingCommunityWorld, setIsLaunchingCommunityWorld] = useState(false)
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)

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

  const handleCloseCommunityWorldDialog = useCallback(() => {
    if (isCommunityWorldDialogLoading || isLaunchingCommunityWorld || isCommunityRatingSaving) {
      return
    }
    setSelectedCommunityWorld(null)
    setCommunityRatingDraft(0)
  }, [isCommunityRatingSaving, isCommunityWorldDialogLoading, isLaunchingCommunityWorld])

  const handleRateCommunityWorld = useCallback(async () => {
    if (!selectedCommunityWorld || communityRatingDraft < 1 || communityRatingDraft > 5 || isCommunityRatingSaving) {
      return
    }
    setActionError('')
    setIsCommunityRatingSaving(true)
    try {
      const updatedWorld = await rateCommunityWorld({
        token: authToken,
        worldId: selectedCommunityWorld.world.id,
        rating: communityRatingDraft,
      })
      setSelectedCommunityWorld((previous) => (previous ? { ...previous, world: updatedWorld } : previous))
      setCommunityWorlds((previous) => previous.map((world) => (world.id === updatedWorld.id ? updatedWorld : world)))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить рейтинг'
      setActionError(detail)
    } finally {
      setIsCommunityRatingSaving(false)
    }
  }, [authToken, communityRatingDraft, isCommunityRatingSaving, selectedCommunityWorld])

  const handleLaunchCommunityWorld = useCallback(async () => {
    if (!selectedCommunityWorld || isLaunchingCommunityWorld) {
      return
    }
    setActionError('')
    setIsLaunchingCommunityWorld(true)
    try {
      const game = await launchCommunityWorld({
        token: authToken,
        worldId: selectedCommunityWorld.world.id,
      })
      onNavigate(`/home/${game.id}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось запустить мир'
      setActionError(detail)
    } finally {
      setIsLaunchingCommunityWorld(false)
    }
  }, [authToken, isLaunchingCommunityWorld, onNavigate, selectedCommunityWorld])

  const avatarInitial = (user.display_name || user.email || 'И').trim().charAt(0).toUpperCase() || 'И'

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
        rightActions={
          <Stack direction="row" spacing={1.2}>
            <IconButton
              aria-label="Поддержка"
              onClick={(event) => event.preventDefault()}
              sx={{
                width: 44,
                height: 44,
                borderRadius: 'var(--morius-radius)',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                transition: 'background-color 180ms ease',
                '&:hover': {
                  backgroundColor: APP_BUTTON_HOVER,
                },
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
                borderRadius: 'var(--morius-radius)',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                transition: 'background-color 180ms ease',
                '&:hover': {
                  backgroundColor: APP_BUTTON_HOVER,
                },
              }}
            >
              <Box component="img" src={icons.theme} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
            </IconButton>
            <Button
              variant="text"
              onClick={() => onNavigate('/dashboard')}
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
              {user.avatar_url && user.avatar_url !== failedAvatarUrl ? (
                <Box
                  component="img"
                  src={user.avatar_url}
                  alt={user.display_name || 'Профиль'}
                  onError={() => setFailedAvatarUrl(user.avatar_url)}
                  sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <Box
                  sx={{
                    width: '100%',
                    height: '100%',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'linear-gradient(180deg, rgba(40, 49, 62, 0.86), rgba(20, 24, 31, 0.95))',
                    color: APP_TEXT_PRIMARY,
                    fontWeight: 700,
                    fontSize: '1rem',
                  }}
                >
                  {avatarInitial}
                </Box>
              )}
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
            <Stack alignItems="center" justifyContent="center" sx={{ py: 3 }}>
              <CircularProgress size={28} />
            </Stack>
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
                gap: 1.3,
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
              }}
            >
              {communityWorlds.map((world) => (
                <Button
                  key={world.id}
                  onClick={() => void handleOpenCommunityWorld(world.id)}
                  disabled={isCommunityWorldDialogLoading}
                  sx={{
                    p: 0,
                    borderRadius: 'var(--morius-radius)',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    textTransform: 'none',
                    textAlign: 'left',
                    alignItems: 'stretch',
                    background: APP_CARD_BACKGROUND,
                    color: APP_TEXT_PRIMARY,
                    minHeight: 256,
                    '&:hover': {
                      borderColor: 'rgba(203, 216, 234, 0.36)',
                      transform: 'translateY(-2px)',
                    },
                  }}
                >
                  <Box
                    sx={{
                      minHeight: { xs: 168, md: 186 },
                      backgroundImage: world.cover_image_url
                        ? `url(${world.cover_image_url})`
                        : `linear-gradient(150deg, hsla(${210 + (world.id % 20)}, 32%, 17%, 0.98) 0%, hsla(${220 + (world.id % 16)}, 36%, 11%, 0.99) 100%)`,
                      backgroundSize: world.cover_image_url ? `${Math.max(1, world.cover_scale || 1) * 100}%` : 'cover',
                      backgroundPosition: world.cover_image_url
                        ? `${world.cover_position_x || 50}% ${world.cover_position_y || 50}%`
                        : 'center',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <Box
                      sx={{
                        mt: 'auto',
                        px: 1.2,
                        py: 1,
                        background:
                          'linear-gradient(180deg, rgba(6, 9, 14, 0.22) 0%, rgba(6, 9, 14, 0.92) 50%, rgba(6, 9, 14, 0.98) 100%)',
                      }}
                    >
                      <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.14rem', fontWeight: 800, lineHeight: 1.18 }}>
                        {world.title}
                      </Typography>
                    </Box>
                  </Box>
                  <Stack spacing={0.6} sx={{ px: 1.2, py: 1.05 }}>
                    <Typography sx={{ fontSize: '0.001rem', lineHeight: 0, opacity: 0 }} aria-hidden>
                      {world.title}
                    </Typography>
                    <Typography
                      sx={{
                        color: APP_TEXT_SECONDARY,
                        fontSize: '0.9rem',
                        lineHeight: 1.42,
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {world.description}
                    </Typography>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}>Автор: {world.author_name}</Typography>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}>
                      Просмотры {world.community_views} • Запуски {world.community_launches}
                    </Typography>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}>
                      Рейтинг {world.community_rating_avg.toFixed(1)} ({world.community_rating_count})
                    </Typography>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}>
                      {world.user_rating ? `Ваша оценка: ${toStarLabel(world.user_rating)}` : 'Нажмите, чтобы открыть и оценить'}
                    </Typography>
                  </Stack>
                </Button>
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
        onClose={handleCloseCommunityWorldDialog}
        onPlay={() => void handleLaunchCommunityWorld()}
        onChangeRating={setCommunityRatingDraft}
        onSaveRating={() => void handleRateCommunityWorld()}
      />
    </Box>
  )
}

export default CommunityWorldsPage
