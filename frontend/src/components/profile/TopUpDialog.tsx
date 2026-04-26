import { useEffect, useState } from 'react'
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
  type DialogProps,
} from '@mui/material'
import { getCurrentUserReferralSummary, type CoinTopUpPlan } from '../../services/authApi'
import mobileCloseIcon from '../../assets/icons/mobile-close.svg'
import chroniclerOrnament from '../../assets/images/topup/chronicler-ornament.svg'
import putnikRibbon from '../../assets/images/topup/putnik-ribbon.svg'
import seekerTrail from '../../assets/images/topup/seeker-trail.svg'
import useMobileDialogSheet from '../dialogs/useMobileDialogSheet'

type TopUpDialogProps = {
  open: boolean
  topUpError: string
  isTopUpPlansLoading: boolean
  topUpPlans: CoinTopUpPlan[]
  activePlanPurchaseId: string | null
  authToken?: string
  referralBonusPending?: boolean
  referralBonusAmount?: number
  transitionComponent?: DialogProps['TransitionComponent']
  onClose: () => void
  onPurchasePlan: (planId: string) => void
}

const PLAN_LOOKUP: Record<
  string,
  {
    accent: string
    imageSrc: string
    lines: string[]
    badge?: string
  }
> = {
  standard: {
    accent: '#5F93F2',
    imageSrc: putnikRibbon,
    lines: [
      'Для старта, тестовых миров и коротких кампаний.',
      'Работает с новым лимитом контекста до 32k.',
      'Один баланс на текст, изображения и эффекты.',
    ],
  },
  pro: {
    accent: '#5DD8BC',
    imageSrc: seekerTrail,
    lines: [
      'Оптимален для регулярной игры и длинных сцен.',
      'Лучший баланс между ценой и запасом солов.',
      'Один баланс на текст, изображения и эффекты.',
    ],
    badge: 'Самый популярный',
  },
  mega: {
    accent: '#F0B45B',
    imageSrc: chroniclerOrnament,
    lines: [
      'Для больших кампаний и тяжёлых сцен с запасом.',
      'Удобен, если часто используете дорогие модели.',
      'Один баланс на текст, изображения и эффекты.',
    ],
  },
}

const DEFAULT_PLAN_CARD = {
  accent: '#5F93F2',
  imageSrc: putnikRibbon,
  lines: [
    'Пакет солов для игры без подписки.',
    'Поддерживает новый лимит контекста до 32k.',
    'Один баланс на текст, изображения и эффекты.',
  ],
}

const POPULAR_PLAN_ID = 'pro'

function TopUpDialog({
  open,
  topUpError,
  isTopUpPlansLoading,
  topUpPlans,
  activePlanPurchaseId,
  authToken,
  referralBonusPending,
  referralBonusAmount,
  transitionComponent,
  onClose,
  onPurchasePlan,
}: TopUpDialogProps) {
  const mobileSheet = useMobileDialogSheet({ onClose })
  const [fetchedReferralBonusPending, setFetchedReferralBonusPending] = useState(false)
  const [fetchedReferralBonusAmount, setFetchedReferralBonusAmount] = useState(500)
  const resolvedReferralBonusPending = referralBonusPending ?? fetchedReferralBonusPending
  const resolvedReferralBonusAmount = referralBonusAmount ?? fetchedReferralBonusAmount

  useEffect(() => {
    if (!open || !authToken || referralBonusPending !== undefined) {
      return
    }
    let active = true
    void getCurrentUserReferralSummary({ token: authToken })
      .then((summary) => {
        if (!active) {
          return
        }
        setFetchedReferralBonusPending(summary.referral_pending_purchase)
        setFetchedReferralBonusAmount(summary.pending_bonus_amount || 500)
      })
      .catch(() => {
        if (active) {
          setFetchedReferralBonusPending(false)
        }
      })
    return () => {
      active = false
    }
  }, [authToken, open, referralBonusPending])
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      TransitionComponent={transitionComponent}
      sx={mobileSheet.dialogSx}
      BackdropProps={{
        sx: mobileSheet.backdropSx,
      }}
      PaperProps={{
        ...mobileSheet.paperTouchHandlers,
        sx: {
          borderRadius: '18px',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: '#111111',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
          ...mobileSheet.paperSx,
        },
      }}
    >
      <DialogTitle sx={{ pb: 1, pr: 7, position: 'relative' }}>
        <Typography sx={{ fontWeight: 900, fontSize: '2rem' }}>Пакеты солов</Typography>
        <Typography sx={{ color: 'var(--morius-text-secondary)', mt: 0.4 }}>
          Выберите пакет и перейдите к оплате.
        </Typography>
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{
            position: 'absolute',
            top: 14,
            right: 14,
            width: 42,
            height: 42,
            color: 'rgba(255,255,255,0.82)',
            backgroundColor: 'transparent',
            '&:hover': {
              backgroundColor: 'transparent',
              color: '#FFFFFF',
            },
          }}
        >
          <Box component="img" src={mobileCloseIcon} alt="" sx={{ width: 18, height: 18, display: 'block', opacity: 0.88 }} />
          <Typography component="span" sx={{ display: 'none', fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>
            ×
          </Typography>
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={{
          pt: 1.2,
          overflowY: 'auto',
          overscrollBehaviorY: 'contain',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <Stack spacing={1.8}>
          {topUpError ? <Alert severity="error">{topUpError}</Alert> : null}
          {resolvedReferralBonusPending ? (
            <Alert
              severity="success"
              sx={{
                borderRadius: '14px',
                backgroundColor: 'rgba(93, 216, 188, 0.12)',
                color: 'rgba(255,255,255,0.88)',
                '& .MuiAlert-icon': {
                  color: '#5DD8BC',
                },
              }}
            >
              После первой покупки по приглашению начислим +{Math.max(0, Math.trunc(resolvedReferralBonusAmount)).toLocaleString('ru-RU')} солов вам и другу.
            </Alert>
          ) : null}
          {isTopUpPlansLoading ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 6 }}>
              <CircularProgress size={30} />
            </Stack>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: 1.8,
                pt: 0.5,
                gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' },
              }}
            >
              {topUpPlans.map((plan) => {
                const isBuying = activePlanPurchaseId === plan.id
                const isPopular = plan.id === POPULAR_PLAN_ID
                const card = PLAN_LOOKUP[plan.id] ?? DEFAULT_PLAN_CARD
                return (
                  <Box
                    key={plan.id}
                    sx={{
                      position: 'relative',
                      borderRadius: '18px',
                      border: isPopular ? `1px solid ${card.accent}` : '1px solid rgba(255,255,255,0.08)',
                      background: isPopular
                        ? 'linear-gradient(180deg, rgba(23, 28, 26, 0.98) 0%, rgba(17, 20, 19, 0.98) 100%)'
                        : '#171716',
                      boxShadow: isPopular ? `0 18px 40px color-mix(in srgb, ${card.accent} 22%, transparent)` : 'none',
                      overflow: 'hidden',
                      minHeight: 430,
                      display: 'grid',
                      gridTemplateRows: '96px minmax(0, 1fr) auto',
                      transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        borderColor: isPopular ? card.accent : 'rgba(255,255,255,0.16)',
                        boxShadow: isPopular
                          ? `0 24px 52px color-mix(in srgb, ${card.accent} 28%, transparent)`
                          : '0 18px 40px rgba(0,0,0,0.28)',
                      },
                    }}
                  >
                    {isPopular && card.badge ? (
                      <Box
                        sx={{
                          position: 'absolute',
                          top: 12,
                          left: 14,
                          zIndex: 3,
                          maxWidth: 'calc(100% - 28px)',
                          px: 1.2,
                          py: 0.45,
                          borderRadius: '999px',
                          bgcolor: 'rgba(17,17,17,0.9)',
                          border: `1px solid color-mix(in srgb, ${card.accent} 46%, rgba(255,255,255,0.22))`,
                          boxShadow: `0 8px 18px color-mix(in srgb, ${card.accent} 16%, transparent)`,
                        }}
                      >
                        <Typography
                          sx={{
                            fontWeight: 900,
                            fontSize: '0.72rem',
                            color: card.accent,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {card.badge}
                        </Typography>
                      </Box>
                    ) : null}
                    <Box
                      sx={{
                        px: 2.2,
                        pt: isPopular ? 3.4 : 1.6,
                        pb: 1.25,
                        background: card.accent,
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'space-between',
                        gap: 1,
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      <Stack spacing={0.75} sx={{ position: 'relative', zIndex: 1, minWidth: 0, flex: 1 }}>
                        <Typography sx={{ fontWeight: 900, fontSize: '1.7rem', color: '#111111' }}>
                          <Box
                            component="span"
                            sx={{
                              display: 'block',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {plan.title}
                          </Box>
                        </Typography>
                      </Stack>
                      <Box
                        component="img"
                        src={card.imageSrc}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        sx={{
                          width: { xs: 112, md: 136 },
                          height: 72,
                          objectFit: 'contain',
                          mr: -1.4,
                          mt: -0.6,
                          flexShrink: 0,
                        }}
                      />
                    </Box>

                    <Stack spacing={1} sx={{ px: 2.2, py: 2.2 }}>
                      <Typography sx={{ fontWeight: 900, fontSize: '3rem', lineHeight: 1, color: '#FFFFFF' }}>
                        {plan.price_rub} ₽
                      </Typography>
                      <Typography sx={{ color: card.accent, fontSize: '1.08rem', fontWeight: 800 }}>
                        {plan.description}
                      </Typography>
                      {card.lines.map((line) => (
                        <Typography key={`${plan.id}-${line}`} sx={{ color: 'rgba(255,255,255,0.78)', fontSize: '1.02rem' }}>
                          {line}
                        </Typography>
                      ))}
                    </Stack>

                    <Box sx={{ px: 2.2, pb: 2.2 }}>
                      <Button
                        variant="contained"
                        disabled={Boolean(activePlanPurchaseId)}
                        onClick={() => onPurchasePlan(plan.id)}
                        sx={{
                          width: '100%',
                          minHeight: 48,
                          borderRadius: '14px',
                          border: isPopular ? `1px solid color-mix(in srgb, ${card.accent} 58%, white)` : 'none',
                          backgroundColor: card.accent,
                          color: '#FFFFFF',
                          fontWeight: 800,
                          fontSize: '1.02rem',
                          boxShadow: isPopular ? `0 12px 24px color-mix(in srgb, ${card.accent} 24%, transparent)` : 'none',
                          '&:hover': {
                            backgroundColor: 'transparent',
                            color: card.accent,
                          },
                        }}
                      >
                        {isBuying ? <CircularProgress size={18} sx={{ color: '#FFFFFF' }} /> : 'Купить'}
                      </Button>
                    </Box>
                  </Box>
                )
              })}
            </Box>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

export default TopUpDialog
