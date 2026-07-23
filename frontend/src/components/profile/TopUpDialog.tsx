import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
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
import SoulAmount from '../currency/SoulAmount'
import PresentationPlanCard from '../shop/PresentationPlanCard'
import mobileCloseIcon from '../../assets/icons/mobile-close.svg'
import planCompassIcon from '../../assets/images/presentation/plan-compass.png'
import planMagnifierIcon from '../../assets/images/presentation/plan-magnifier.png'
import planCrownIcon from '../../assets/images/presentation/plan-crown.png'
import planFeatherIcon from '../../assets/images/presentation/plan-feather.png'
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
    accent: '#6daeff',
    imageSrc: planCompassIcon,
    lines: [
      'Для старта, тестовых миров и коротких кампаний.',
      'Работает с новым лимитом контекста до 64k.',
      'Один баланс на текст, изображения и эффекты.',
    ],
  },
  pro: {
    accent: '#54e4df',
    imageSrc: planMagnifierIcon,
    lines: [
      'Оптимален для регулярной игры и длинных сцен.',
      'Лучший баланс между ценой и запасом.',
      'Один баланс на текст, изображения и эффекты.',
    ],
    badge: 'Самый популярный',
  },
  mega: {
    accent: '#f4b83f',
    imageSrc: planCrownIcon,
    lines: [
      'Для больших кампаний и тяжёлых сцен с запасом.',
      'Удобен, если часто используете дорогие модели.',
      'Один баланс на текст, изображения и эффекты.',
    ],
  },
  legendary: {
    accent: '#bd78ff',
    imageSrc: planFeatherIcon,
    lines: [
      'Максимальный запас для долгих хроник и сложных миров.',
      'Идеален для дорогих моделей и активных кампаний.',
      'Один баланс на текст, изображения и эффекты.',
    ],
  },
}

const DEFAULT_PLAN_CARD = {
  accent: '#6daeff',
  imageSrc: planCompassIcon,
  lines: [
    'Пакет валюты для игры без подписки.',
    'Поддерживает новый лимит контекста до 64k.',
    'Один баланс на текст, изображения и эффекты.',
  ],
}

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
        <Typography sx={{ fontWeight: 900, fontSize: { xs: '1.6rem', sm: '1.9rem' }, lineHeight: 1.12 }}>Пакеты валюты</Typography>
        <Typography sx={{ color: 'var(--morius-text-secondary)', mt: 0.45, fontSize: '0.98rem', lineHeight: 1.35 }}>
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
            color: 'var(--morius-text-secondary)',
            backgroundColor: 'var(--morius-elevated-bg)',
            '&:hover': {
              backgroundColor: 'var(--morius-button-hover)',
              color: 'var(--morius-title-text)',
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
        className="morius-scrollbar"
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
              После первой покупки по приглашению начислим <SoulAmount amount={`+${Math.max(0, Math.trunc(resolvedReferralBonusAmount)).toLocaleString('ru-RU')}`} iconSize={17} /> вам и другу.
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
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
              }}
            >
              {topUpPlans.map((plan) => {
                const isBuying = activePlanPurchaseId === plan.id
                const card = PLAN_LOOKUP[plan.id] ?? DEFAULT_PLAN_CARD
                return (
                  <PresentationPlanCard
                    key={plan.id}
                    title={plan.title}
                    price={`${plan.price_rub.toLocaleString('ru-RU')} ₽`}
                    accent={card.accent}
                    details={card.lines}
                    iconSrc={card.imageSrc}
                    balance={plan.coins.toLocaleString('ru-RU')}
                    badge={card.badge}
                    buttonLabel={isBuying ? 'Открываем оплату…' : 'Купить'}
                    onClick={() => onPurchasePlan(plan.id)}
                    disabled={Boolean(activePlanPurchaseId)}
                    minHeight={500}
                  />
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
