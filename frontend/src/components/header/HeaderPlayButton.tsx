import { useState, type MouseEvent } from 'react'
import { Box, ButtonBase, CircularProgress, Popover, Stack, SvgIcon, Typography } from '@mui/material'
import mobilePlayIconMarkup from '../../assets/icons/mobile-play.svg?raw'
import { listStoryGames } from '../../services/storyApi'
import { navigateInApp } from '../../utils/navigation'
import { selectLastPlayedGame } from '../../utils/storyGameActivity'
import ThemedSvgIcon from '../icons/ThemedSvgIcon'
import { HEADER_CONTROL_SIZE } from './headerStyles'

const RECENT_GAME_LOOKUP_LIMIT = 12

type HeaderPlayButtonProps = {
  authToken: string
}

function HeaderPlayButton({ authToken }: HeaderPlayButtonProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [hasResolvedRecentGame, setHasResolvedRecentGame] = useState(false)
  const [recentGame, setRecentGame] = useState<{ id: number; title: string } | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)

  const loadRecentGame = async () => {
    if (isResolving) {
      return
    }
    setIsResolving(true)
    setLookupFailed(false)
    try {
      const games = await listStoryGames(authToken, { compact: true, limit: RECENT_GAME_LOOKUP_LIMIT })
      const lastPlayedGame = selectLastPlayedGame(games)
      setRecentGame(lastPlayedGame ? { id: lastPlayedGame.id, title: lastPlayedGame.title.trim() || 'Последняя игра' } : null)
      setHasResolvedRecentGame(true)
    } catch {
      setLookupFailed(true)
    } finally {
      setIsResolving(false)
    }
  }

  const handleOpen = (event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
    setHasResolvedRecentGame(false)
    setRecentGame(null)
    void loadRecentGame()
  }

  const handleClose = () => setAnchorEl(null)

  const handleNewGame = () => {
    handleClose()
    navigateInApp('/worlds/new')
  }

  const handleContinue = () => {
    handleClose()
    if (recentGame) {
      navigateInApp(`/home/${recentGame.id}`)
      return
    }
    if (lookupFailed) {
      navigateInApp('/dashboard?mobileAction=continue')
    }
  }

  const isOpen = Boolean(anchorEl)
  const continueDisabled = isResolving || (hasResolvedRecentGame && !recentGame && !lookupFailed)
  const continueHint = isResolving
    ? 'Ищем последнюю историю…'
    : recentGame
      ? recentGame.title
      : lookupFailed
        ? 'Повторить через главную'
        : 'Пока нет начатых игр'

  return (
    <>
      <Box
        component="button"
        type="button"
        className="morius-header-play"
        onClick={handleOpen}
        aria-label="Играть"
        aria-haspopup="menu"
        aria-expanded={isOpen ? 'true' : undefined}
        data-tour-id="header-play-button"
        sx={{
          position: 'relative',
          height: HEADER_CONTROL_SIZE,
          flex: '0 0 auto',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          px: '16px',
          border: 'none',
          borderRadius: '12px',
          background: 'var(--morius-accent-gradient)',
          boxShadow: 'var(--morius-accent-shadow)',
          color: '#fff',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: '0.875rem',
          fontWeight: 600,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          transition: 'filter 160ms ease, transform 160ms ease',
          '&:hover': { filter: 'brightness(1.08)' },
          '&:active': { transform: 'translateY(1px)' },
          '&:focus-visible': {
            outline: '2px solid color-mix(in oklab, var(--morius-accent) 70%, #fff)',
            outlineOffset: '2px',
          },
        }}
      >
        <ThemedSvgIcon markup={mobilePlayIconMarkup} size={16} sx={{ color: '#fff' }} />
        <Box component="span" sx={{ display: 'inline-block', lineHeight: 1 }}>Играть</Box>
      </Box>

      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={handleClose}
        disableScrollLock
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              width: 304,
              mt: 1.1,
              p: 1.15,
              overflow: 'visible',
              borderRadius: '18px !important',
              border: 'var(--morius-border-width) solid var(--morius-menu-border) !important',
              background: 'var(--morius-menu-gradient) !important',
              boxShadow: '0 24px 58px -22px rgba(0,0,0,0.92) !important',
              '&::before': {
                content: '""',
                position: 'absolute',
                top: -6,
                right: 28,
                width: 11,
                height: 11,
                transform: 'rotate(45deg)',
                borderTop: 'var(--morius-border-width) solid var(--morius-menu-border)',
                borderLeft: 'var(--morius-border-width) solid var(--morius-menu-border)',
                background: 'color-mix(in srgb, var(--morius-card-bg) 88%, var(--morius-elevated-bg) 12%)',
              },
            },
          },
        }}
      >
        <Stack spacing={0.75} role="menu" aria-label="Выбор игры">
          <Stack spacing={0.2} sx={{ px: 0.9, pt: 0.55, pb: 0.8 }}>
            <Typography sx={{ color: 'var(--morius-title-text)', fontFamily: 'var(--morius-font-heading)', fontSize: '1rem', fontWeight: 700 }}>
              Начать приключение
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem' }}>
              Создайте новую историю или вернитесь к последней.
            </Typography>
          </Stack>

          <ButtonBase
            role="menuitem"
            onClick={handleNewGame}
            sx={{
              width: '100%',
              minHeight: 68,
              justifyContent: 'flex-start',
              gap: 1.15,
              p: 1.05,
              borderRadius: '13px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'rgba(255,255,255,0.035)',
              textAlign: 'left',
              '&:hover': { backgroundColor: 'var(--morius-button-hover)', borderColor: 'var(--morius-hover-border)' },
            }}
          >
            <Box sx={{ width: 40, height: 40, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: '12px', color: '#fff', background: 'var(--morius-accent-gradient)', boxShadow: 'var(--morius-accent-shadow)' }}>
              <SvgIcon viewBox="0 0 24 24" sx={{ width: 20, height: 20 }}>
                <path d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z" fill="currentColor" />
              </SvgIcon>
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.88rem', fontWeight: 750 }}>Новая игра</Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem' }}>Создать новый мир и историю</Typography>
            </Box>
            <Typography aria-hidden sx={{ color: 'var(--morius-muted-text)', fontSize: '1rem' }}>›</Typography>
          </ButtonBase>

          <ButtonBase
            role="menuitem"
            onClick={handleContinue}
            disabled={continueDisabled}
            sx={{
              width: '100%',
              minHeight: 68,
              justifyContent: 'flex-start',
              gap: 1.15,
              p: 1.05,
              borderRadius: '13px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'rgba(255,255,255,0.035)',
              textAlign: 'left',
              '&:hover': { backgroundColor: 'var(--morius-button-hover)', borderColor: 'var(--morius-hover-border)' },
              '&.Mui-disabled': { opacity: 0.48 },
            }}
          >
            <Box sx={{ width: 40, height: 40, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: '12px', color: 'var(--morius-accent)', border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 34%, transparent)', backgroundColor: 'color-mix(in srgb, var(--morius-accent) 12%, transparent)' }}>
              {isResolving ? (
                <CircularProgress size={18} thickness={4.5} sx={{ color: 'var(--morius-accent)' }} />
              ) : (
                <ThemedSvgIcon markup={mobilePlayIconMarkup} size={18} sx={{ color: 'currentColor' }} />
              )}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.88rem', fontWeight: 750 }}>Продолжить</Typography>
              <Typography noWrap title={continueHint} sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem' }}>{continueHint}</Typography>
            </Box>
            <Typography aria-hidden sx={{ color: 'var(--morius-muted-text)', fontSize: '1rem' }}>›</Typography>
          </ButtonBase>
        </Stack>
      </Popover>
    </>
  )
}

export default HeaderPlayButton
