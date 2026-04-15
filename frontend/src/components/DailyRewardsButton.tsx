import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Alert, Box, CircularProgress, IconButton, Popover, Stack, Typography } from '@mui/material'
import { icons } from '../assets'
import dailyDiamondIconMarkup from '../assets/icons/daily-diamond.svg?raw'
import dailyRewardCheckIconMarkup from '../assets/icons/daily-reward-check.svg?raw'
import dailyRewardFlagIconMarkup from '../assets/icons/daily-reward-flag.svg?raw'
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
    const isDisabled = !isClaimable || isClaiming
    const statusIconMarkup = isClaimed ? dailyRewardCheckIconMarkup : isClaimable ? dailyRewardFlagIconMarkup : dailyRewardLockIconMarkup
    const rewardIcon = isBoosted ? icons.coin : icons.dailyRewardsCoin
    const rewardIconSize = isBoosted ? { width: 15, height: 15 } : { width: 13, height: 9 }
    const cardBackground = isClaimed
      ? 'color-mix(in srgb, var(--morius-elevated-bg) 94%, var(--morius-title-text) 6%)'
      : 'color-mix(in srgb, var(--morius-app-base) 88%, var(--morius-card-bg) 12%)'
    const insetOutline = isClaimable
      ? '0 0 0 1px color-mix(in srgb, var(--morius-accent) 84%, white 16%) inset'
      : isBoosted
        ? '0 0 0 1px color-mix(in srgb, var(--morius-accent) 68%, transparent) inset'
        : '0 0 0 1px color-mix(in srgb, rgba(255, 255, 255, 0.08) 55%, transparent) inset'
    const glowShadow = isClaimable
      ? '0 0 28px color-mix(in srgb, var(--morius-accent) 34%, transparent), 0 16px 28px rgba(0, 0, 0, 0.34)'
      : isBoosted
        ? '0 0 20px color-mix(in srgb, var(--morius-accent) 18%, transparent), 0 14px 26px rgba(0, 0, 0, 0.26)'
        : '0 12px 22px rgba(0, 0, 0, 0.22)'
    const topColor = isClaimed
      ? 'color-mix(in srgb, var(--morius-text-secondary) 82%, var(--morius-title-text) 18%)'
      : 'var(--morius-title-text)'
    const statusColor = isClaimed
      ? 'color-mix(in srgb, var(--morius-text-secondary) 80%, var(--morius-title-text) 20%)'
      : isClaimable
        ? 'var(--morius-title-text)'
        : 'color-mix(in srgb, var(--morius-text-secondary) 88%, transparent)'
    const rewardColor = isClaimed ? 'var(--morius-text-secondary)' : 'var(--morius-title-text)'
    const rewardIconOpacity = isClaimed ? 0.58 : 0.94

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
          minWidth: 0,
          minHeight: 78,
          px: 0.95,
          py: 0.82,
          border: 'none',
          borderRadius: '16px',
          textAlign: 'left',
          font: 'inherit',
          background: cardBackground,
          boxShadow: `${insetOutline}, ${glowShadow}`,
          color: rewardColor,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          cursor: isClaimable ? 'pointer' : 'default',
          transition: 'transform 160ms ease, box-shadow 160ms ease, background-color 160ms ease',
          '&:hover': isClaimable
            ? {
                transform: 'translateY(-1px)',
                boxShadow: `${insetOutline}, 0 0 32px color-mix(in srgb, var(--morius-accent) 38%, transparent), 0 18px 32px rgba(0, 0, 0, 0.36)`,
              }
            : undefined,
          '&:disabled': {
            opacity: 1,
          },
        }}
      >
        {isClaimable && isClaiming ? (
          <Stack alignItems="center" justifyContent="center" sx={{ flex: 1 }}>
            <CircularProgress size={20} sx={{ color: 'var(--morius-title-text)' }} />
          </Stack>
        ) : (
          <>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Box sx={{ color: statusColor, display: 'inline-flex', alignItems: 'center' }}>
                <ThemedSvgIcon markup={statusIconMarkup} size={12} />
              </Box>
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 800,
                  lineHeight: 1,
                  color: topColor,
                }}
              >
                {reward.day}
              </Typography>
            </Stack>

            <Box
              sx={{
                width: '100%',
                height: '1px',
                my: 0.38,
                backgroundColor: isClaimed
                  ? 'color-mix(in srgb, var(--morius-text-secondary) 24%, transparent)'
                  : 'color-mix(in srgb, var(--morius-title-text) 14%, transparent)',
              }}
            />

            <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minHeight: 18 }}>
              <Box component="img" src={rewardIcon} alt="" sx={{ ...rewardIconSize, opacity: rewardIconOpacity }} />
              <Typography
                sx={{
                  fontSize: '16px',
                  fontWeight: 900,
                  lineHeight: 1,
                  color: rewardColor,
                }}
              >
                {reward.amount}
              </Typography>
            </Stack>
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
          color: canClaim ? 'var(--morius-accent)' : 'var(--morius-title-text)',
          backgroundColor: 'var(--morius-elevated-bg)',
          boxShadow: canClaim
            ? '0 0 0 1px color-mix(in srgb, var(--morius-accent) 56%, transparent) inset, 0 0 18px color-mix(in srgb, var(--morius-accent) 20%, transparent), 0 10px 20px rgba(0, 0, 0, 0.2)'
            : '0 0 0 1px color-mix(in srgb, var(--morius-card-border) 72%, transparent) inset, 0 10px 20px rgba(0, 0, 0, 0.18)',
          transition: 'transform 160ms ease, box-shadow 160ms ease, background-color 160ms ease',
          '&:hover': {
            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, var(--morius-card-bg) 12%)',
            boxShadow: canClaim
              ? '0 0 0 1px color-mix(in srgb, var(--morius-accent) 64%, transparent) inset, 0 0 22px color-mix(in srgb, var(--morius-accent) 24%, transparent), 0 12px 22px rgba(0, 0, 0, 0.22)'
              : '0 0 0 1px color-mix(in srgb, var(--morius-card-border) 82%, transparent) inset, 0 12px 22px rgba(0, 0, 0, 0.2)',
            transform: 'translateY(-1px)',
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
            width: 298,
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
              gap: 0.9,
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
