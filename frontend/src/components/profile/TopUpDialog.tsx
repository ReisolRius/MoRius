import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
  type DialogProps,
} from '@mui/material'
import type { CoinTopUpPlan } from '../../services/authApi'
import chroniclerOrnament from '../../assets/images/topup/chronicler-ornament.svg'
import putnikRibbon from '../../assets/images/topup/putnik-ribbon.svg'
import seekerTrail from '../../assets/images/topup/seeker-trail.svg'

type TopUpDialogProps = {
  open: boolean
  topUpError: string
  isTopUpPlansLoading: boolean
  topUpPlans: CoinTopUpPlan[]
  activePlanPurchaseId: string | null
  transitionComponent?: DialogProps['TransitionComponent']
  onClose: () => void
  onPurchasePlan: (planId: string) => void
}

const PLAN_LOOKUP: Record<
  string,
  {
    title: string
    accent: string
    imageSrc: string
    lines: string[]
  }
> = {
  standard: {
    title: 'Путник',
    accent: '#5F93F2',
    imageSrc: putnikRibbon,
    lines: [
      'Солы: 400',
      'До 15к контекста (~70к символов)',
      '~ 100 генерируемых картинок',
      '~ 250 ходов',
    ],
  },
  pro: {
    title: 'Искатель',
    accent: '#5DD8BC',
    imageSrc: seekerTrail,
    lines: [
      'Солы: 1300',
      'До 15к контекста (~70к символов)',
      '~ 350 генерируемых картинок',
      '~ 750 ходов',
    ],
  },
  mega: {
    title: 'Хронист',
    accent: '#F0B45B',
    imageSrc: chroniclerOrnament,
    lines: [
      'Солы: 3500',
      'До 15к контекста (~70к символов)',
      '~ 900 генерируемых картинок',
      '~ 2700 ходов',
    ],
  },
}

function TopUpDialog({
  open,
  topUpError,
  isTopUpPlansLoading,
  topUpPlans,
  activePlanPurchaseId,
  transitionComponent,
  onClose,
  onPurchasePlan,
}: TopUpDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      TransitionComponent={transitionComponent}
      PaperProps={{
        sx: {
          borderRadius: '18px',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: '#111111',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography sx={{ fontWeight: 900, fontSize: '2rem' }}>Пакеты солов</Typography>
        <Typography sx={{ color: 'var(--morius-text-secondary)', mt: 0.4 }}>
          Выберите пакет и перейдите к оплате.
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={1.8}>
          {topUpError ? <Alert severity="error">{topUpError}</Alert> : null}
          {isTopUpPlansLoading ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 6 }}>
              <CircularProgress size={30} />
            </Stack>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: 1.8,
                gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' },
              }}
            >
              {topUpPlans.map((plan) => {
                const isBuying = activePlanPurchaseId === plan.id
                const card = PLAN_LOOKUP[plan.id] ?? PLAN_LOOKUP.standard
                return (
                  <Box
                    key={plan.id}
                    sx={{
                      borderRadius: '18px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: '#171716',
                      overflow: 'hidden',
                      minHeight: 410,
                      display: 'grid',
                      gridTemplateRows: '80px minmax(0, 1fr) auto',
                    }}
                  >
                    <Box
                      sx={{
                        px: 2.2,
                        py: 1.6,
                        background: card.accent,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1,
                        overflow: 'hidden',
                      }}
                    >
                      <Typography sx={{ fontWeight: 900, fontSize: '1.7rem', color: '#111111', position: 'relative', zIndex: 1 }}>
                        {card.title}
                      </Typography>
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

                    <Stack spacing={0.9} sx={{ px: 2.2, py: 2.2 }}>
                      <Typography sx={{ fontWeight: 900, fontSize: '3rem', lineHeight: 1, color: '#FFFFFF' }}>
                        {plan.price_rub} ₽
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
                          border: 'none',
                          backgroundColor: card.accent,
                          color: '#FFFFFF',
                          fontWeight: 800,
                          fontSize: '1.02rem',
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
      <DialogActions sx={{ px: 3, pb: 2.4 }}>
        <Button onClick={onClose} sx={{ color: 'var(--morius-text-secondary)' }}>
          Назад
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default TopUpDialog
