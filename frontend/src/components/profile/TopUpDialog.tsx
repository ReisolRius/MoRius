import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography, type DialogProps } from '@mui/material'
import type { CoinTopUpPlan } from '../../services/authApi'

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
      maxWidth="md"
      fullWidth
      TransitionComponent={transitionComponent}
      PaperProps={{
        sx: {
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
        },
      }}
    >
      <DialogTitle sx={{ pb: 0.8 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '1.55rem' }}>Пополнение монет</Typography>
        <Typography sx={{ color: 'text.secondary', mt: 0.6 }}>
          Выберите пакет и нажмите «Купить», чтобы перейти к оплате.
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
                gap: 1.6,
                gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
              }}
            >
              {topUpPlans.map((plan) => {
                const isBuying = activePlanPurchaseId === plan.id
                return (
                  <Box
                    key={plan.id}
                    sx={{
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      background: 'var(--morius-card-bg)',
                      px: 2,
                      py: 2,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      minHeight: 210,
                    }}
                  >
                    <Stack spacing={0.7}>
                      <Typography sx={{ fontSize: '1.05rem', fontWeight: 700 }}>{plan.title}</Typography>
                      <Typography sx={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--morius-text-primary)' }}>
                        {plan.price_rub} ₽
                      </Typography>
                      <Typography sx={{ fontSize: '0.95rem', color: 'text.secondary' }}>{plan.description}</Typography>
                      <Typography sx={{ fontSize: '0.95rem', color: 'text.secondary' }}>
                        +{plan.coins.toLocaleString('ru-RU')} монет
                      </Typography>
                    </Stack>
                    <Button
                      variant="contained"
                      disabled={Boolean(activePlanPurchaseId)}
                      onClick={() => onPurchasePlan(plan.id)}
                      sx={{
                        mt: 2,
                        minHeight: 40,
                        borderRadius: 'var(--morius-radius)',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        backgroundColor: 'var(--morius-button-active)',
                        color: 'var(--morius-text-primary)',
                        fontWeight: 700,
                        '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
                      }}
                    >
                      {isBuying ? <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} /> : 'Купить'}
                    </Button>
                  </Box>
                )
              })}
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.4 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>
          Назад
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default TopUpDialog
