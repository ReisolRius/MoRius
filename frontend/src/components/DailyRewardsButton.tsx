import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Alert, Box, CircularProgress, IconButton, Popover, Stack, Typography } from '@mui/material'
import { icons } from '../assets'
import dailyDiamondIconMarkup from '../assets/icons/daily-diamond.svg?raw'
import dailyRewardCheckIconMarkup from '../assets/icons/daily-reward-check.svg?raw'
import dailyRewardLockIconMarkup from '../assets/icons/daily-reward-lock.svg?raw'
import {
  claimCurrentUserDailyReward,
  getCurrentUserDailyRewards,
  type DailyRewardDay,
  type DailyRewardStatus,
} from '../services/authApi'
import ThemedSvgIcon from './icons/ThemedSvgIcon'

type DailyRewardsButtonProps = {
  authToken: string
  size?: number
}

const BOOSTED_REWARD_DAYS = new Set([7, 14, 21, 28])

function DailyRewardsButton({ authToken, size = 40 }: DailyRewardsButtonProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [status, setStatus] = useState<DailyRewardStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isClaiming, setIsClaiming] = useState(false)
  const [error, setError] = useState('')

  const open = Boolean(anchorEl)

  const loadStatus = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const nextStatus = await getCurrentUserDailyRewards({ token: authToken })
      setStatus(nextStatus)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить ежедневные награды')
    } finally {
      setIsLoading(false)
    }
  }, [authToken])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    const nextClaimAt = typeof status?.next_claim_at === 'string' ? Date.parse(status.next_claim_at) : Number.NaN
    if (!Number.isFinite(nextClaimAt)) {
      return
    }
    const timeoutMs = Math.max(nextClaimAt - Date.now() + 1000, 1000)
    const timeoutId = window.setTimeout(() => {
      void loadStatus()
    }, Math.min(timeoutMs, 2_147_483_647))
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loadStatus, status?.next_claim_at])

  const handleTogglePopover = (event: ReactMouseEvent<HTMLElement>) => {
    if (open) {
      setAnchorEl(null)
      return
    }
    setAnchorEl(event.currentTarget)
    if (!isLoading) {
      void loadStatus()
    }
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  const handleClaim = async () => {
    if (isClaiming || !status?.can_claim) {
      return
    }
    setIsClaiming(true)
    setError('')
    try {
      const nextStatus = await claimCurrentUserDailyReward({ token: authToken })
      setStatus(nextStatus)
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : 'Не удалось забрать награду')
    } finally {
      setIsClaiming(false)
    }
  }

  const canClaim = Boolean(status?.can_claim)

  const renderRewardCard = (reward: DailyRewardDay) => {
    const isBoosted = BOOSTED_REWARD_DAYS.has(reward.day)
    const isClaimable = canClaim && reward.is_current
    const isClaimed = reward.is_claimed
    const isLocked = !isClaimable && !isClaimed
    const isDisabled = !isClaimable || isClaiming

    const coinIcon = isBoosted ? icons.coin : icons.dailyRewardsCoin
    const coinSize = isBoosted ? { width: 18, height: 18 } : { width: 20, height: 13 }
    const coinOpacity = isClaimed ? 0.45 : 0.95
    const textColor = isClaimed ? 'var(--morius-text-secondary)' : 'var(--morius-title-text)'

    const cardBg = isClaimed
      ? 'color-mix(in srgb, var(--morius-elevated-bg) 90%, var(--morius-title-text) 10%)'
      : isClaimable
        ? 'color-mix(in srgb, var(--morius-card-bg) 95%, var(--morius-accent) 5%)'
        : 'color-mix(in srgb, var(--morius-app-base) 76%, var(--morius-card-bg) 24%)'

    const boxShadow = isClaimable
      ? '0 0 0 1.5px color-mix(in srgb, var(--morius-accent) 88%, white 12%) inset, 0 0 16px color-mix(in srgb, var(--morius-accent) 28%, transparent)'
      : '0 0 0 1px rgba(255,255,255,0.06) inset'

    return (
      <Box
        key={reward.day}
        component="button"
        type="button"
        disabled={isDisabled}
        onClick={() => {
          if (isClaimable) {
            void handleClaim()
          }
        }}
        sx={{
          position: 'relative',
          minWidth: 0,
          height: 42,
          px: 1,
          border: 'none',
          borderRadius: '100px',
          font: 'inherit',
          background: cardBg,
          boxShadow,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '5px',
          cursor: isClaimable ? 'pointer' : 'default',
          transition: 'transform 150ms ease, box-shadow 150ms ease',
          '&:hover': isClaimable
            ? {
                transform: 'translateY(-1px)',
                boxShadow: '0 0 0 1.5px color-mix(in srgb, var(--morius-accent) 88%, white 12%) inset, 0 0 24px color-mix(in srgb, var(--morius-accent) 40%, transparent)',
              }
            : undefined,
          '&:disabled': { opacity: 1 },
        }}
      >
        {/* Status badge: lock or check at top-right */}
        {(isLocked || isClaimed) && (
          <Box
            sx={{
              position: 'absolute',
              top: 3,
              right: 6,
              display: 'flex',
              color: isClaimed
                ? 'color-mix(in srgb, var(--morius-text-secondary) 85%, white 15%)'
                : 'rgba(255,255,255,0.26)',
            }}
          >
            <ThemedSvgIcon markup={isClaimed ? dailyRewardCheckIconMarkup : dailyRewardLockIconMarkup} size={9} />
          </Box>
        )}

        {/* Coin + amount */}
        {isClaimable && isClaiming ? (
          <CircularProgress size={16} sx={{ color: 'var(--morius-title-text)' }} />
        ) : (
          <>
            <Box component="img" src={coinIcon} alt="" sx={{ ...coinSize, opacity: coinOpacity, flexShrink: 0 }} />
            <Typography
              sx={{
                fontSize: '13px',
                fontWeight: 900,
                lineHeight: 1,
                color: textColor,
              }}
            >
              {reward.amount}
            </Typography>
          </>
        )}
      </Box>
    )
  }

  return (
    <>
      <IconButton
        onClick={handleTogglePopover}
        aria-label="Ежедневные награды"
        aria-expanded={open ? 'true' : undefined}
        sx={{
          minWidth: 0,
          width: size,
          height: size,
          borderRadius: '50%',
          p: 0,
          color: canClaim ? 'var(--morius-accent)' : 'var(--morius-text-secondary)',
          backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 92%, transparent)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.28)',
          transition: 'background-color 160ms ease, color 160ms ease, border-color 160ms ease',
          position: 'relative',
          overflow: 'visible',
          '&:hover': {
            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 96%, white 4%)',
            borderColor: 'rgba(255,255,255,0.18)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.32)',
          },
        }}
      >
        <ThemedSvgIcon
          markup={dailyDiamondIconMarkup}
          size={Math.max(20, Math.round(size * 0.52))}
          sx={{
            color: 'inherit',
            opacity: canClaim ? 1 : 0.96,
          }}
        />
        {canClaim ? (
          <Box
            aria-hidden="true"
            sx={{
              position: 'absolute',
              top: 4,
              right: 3,
              width: 9,
              height: 9,
              borderRadius: '50%',
              backgroundColor: 'var(--morius-accent)',
              boxShadow: '0 0 0 2px var(--morius-app-bg)',
              pointerEvents: 'none',
            }}
          />
        ) : null}
      </IconButton>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        disableScrollLock
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        PaperProps={{
          sx: {
            mt: 0.95,
            width: 348,
            maxWidth: 'calc(100vw - 24px)',
            p: 1.7,
            borderRadius: '24px',
            border: 'none',
            background: 'color-mix(in srgb, var(--morius-card-bg) 96%, black 4%)',
            boxShadow: 'none',
            overflow: 'hidden',
          },
        }}
      >
        <Stack spacing={1.25}>
          <Typography
            sx={{
              fontSize: '20px',
              fontWeight: 900,
              lineHeight: 1,
              textAlign: 'center',
              color: 'var(--morius-title-text)',
            }}
          >
            Ежедневки
          </Typography>

          {error ? (
            <Alert
              severity="error"
              sx={{
                borderRadius: '14px',
                py: 0.2,
                '& .MuiAlert-message': {
                  fontSize: '0.82rem',
                },
              }}
            >
              {error}
            </Alert>
          ) : null}

          {isLoading && !status ? (
            <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 360 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : (
            <Box
              sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 0.75,
            }}
          >
              {(status?.days ?? []).map(renderRewardCard)}
            </Box>
          )}
        </Stack>
      </Popover>
    </>
  )
}

export default DailyRewardsButton
