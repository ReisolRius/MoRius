import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import { icons } from '../assets'
import {
  claimCurrentUserDailyReward,
  getCurrentUserDailyRewards,
  type DailyRewardStatus,
} from '../services/authApi'

type DailyRewardsButtonProps = {
  authToken: string
  size?: number
}

function DailyRewardsButton({ authToken, size = 40 }: DailyRewardsButtonProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<DailyRewardStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isClaiming, setIsClaiming] = useState(false)
  const [error, setError] = useState('')

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

  const handleOpen = () => {
    setOpen(true)
    if (!status && !isLoading) {
      void loadStatus()
    }
  }

  const handleClaim = async () => {
    if (isClaiming) {
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

  const currentRewardLabel = useMemo(() => {
    if (!status?.reward_amount) {
      return 'Все награды собраны'
    }
    return `Сегодня можно получить ${status.reward_amount} солов`
  }, [status])

  return (
    <>
      <IconButton
        onClick={handleOpen}
        aria-label="Ежедневные награды"
        sx={{
          minWidth: 0,
          width: size,
          height: size,
          borderRadius: '50%',
          p: 0,
          color: status?.can_claim ? 'var(--morius-accent)' : 'var(--morius-text-secondary)',
          backgroundColor: 'transparent',
          '&:hover': {
            backgroundColor: 'transparent',
          },
        }}
      >
        <Box component="img" src={icons.dailyRewards} alt="" sx={{ width: 18, height: 18, opacity: 0.96 }} />
      </IconButton>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '22px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            boxShadow: '0 28px 80px rgba(0, 0, 0, 0.48)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 0.4 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '2rem', textAlign: 'center' }}>Ежедневки</Typography>
        </DialogTitle>
        <DialogContent sx={{ px: 2.2, pb: 2.4 }}>
          <Stack spacing={1.6}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {isLoading && !status ? (
              <Stack alignItems="center" justifyContent="center" sx={{ py: 6 }}>
                <CircularProgress size={30} />
              </Stack>
            ) : (
              <>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: 1,
                  }}
                >
                  {(status?.days ?? []).map((reward) => {
                    const isHighlighted = reward.is_current || reward.is_claimed
                    return (
                      <Box
                        key={reward.day}
                        sx={{
                          minHeight: 64,
                          borderRadius: '14px',
                          border: `1px solid ${
                            reward.is_current ? 'color-mix(in srgb, var(--morius-accent) 82%, transparent)' : 'transparent'
                          }`,
                          background: reward.is_claimed
                            ? 'color-mix(in srgb, var(--morius-elevated-bg) 88%, var(--morius-accent) 12%)'
                            : 'var(--morius-elevated-bg)',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          px: 1,
                          py: 0.8,
                          boxShadow: reward.is_current
                            ? '0 0 0 1px color-mix(in srgb, var(--morius-accent) 40%, transparent) inset'
                            : 'none',
                        }}
                      >
                        <Typography
                          sx={{
                            fontSize: '0.85rem',
                            fontWeight: 800,
                            color: isHighlighted ? 'var(--morius-title-text)' : 'var(--morius-text-secondary)',
                          }}
                        >
                          {reward.day}
                        </Typography>
                        <Stack direction="row" spacing={0.4} alignItems="center">
                          <Box
                            component="img"
                            src={icons.dailyRewards}
                            alt=""
                            sx={{ width: 13, height: 13, opacity: reward.is_locked ? 0.45 : 0.95 }}
                          />
                          <Typography
                            sx={{
                              fontSize: '1rem',
                              fontWeight: 800,
                              color: reward.is_locked ? 'var(--morius-text-secondary)' : 'var(--morius-title-text)',
                            }}
                          >
                            {reward.amount}
                          </Typography>
                        </Stack>
                      </Box>
                    )
                  })}
                </Box>

                <Stack spacing={0.3} alignItems="center" sx={{ pt: 0.4 }}>
                  <Typography sx={{ fontWeight: 700, color: 'var(--morius-title-text)' }}>{currentRewardLabel}</Typography>
                  {status?.next_claim_at ? (
                    <Typography sx={{ fontSize: '0.92rem', color: 'var(--morius-text-secondary)' }}>
                      Следующая награда станет доступна позже
                    </Typography>
                  ) : null}
                </Stack>

                <Button
                  variant="contained"
                  disabled={!status?.can_claim || isClaiming}
                  onClick={() => void handleClaim()}
                  sx={{
                    minHeight: 44,
                    borderRadius: '14px',
                    backgroundColor: 'var(--morius-button-active)',
                    color: 'var(--morius-title-text)',
                    fontWeight: 800,
                    '&:hover': {
                      backgroundColor: 'transparent',
                    },
                  }}
                >
                  {isClaiming ? <CircularProgress size={18} /> : (status?.can_claim ? 'Забрать награду' : 'Недоступно')}
                </Button>
              </>
            )}
          </Stack>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default DailyRewardsButton
