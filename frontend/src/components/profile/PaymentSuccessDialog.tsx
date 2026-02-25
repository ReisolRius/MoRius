import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography, type DialogProps } from '@mui/material'

type PaymentSuccessDialogProps = {
  open: boolean
  coins: number
  onClose: () => void
  transitionComponent?: DialogProps['TransitionComponent']
}

function PaymentSuccessDialog({ open, coins, onClose, transitionComponent }: PaymentSuccessDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      TransitionComponent={transitionComponent}
      BackdropProps={{
        sx: {
          backgroundColor: 'rgba(2, 4, 8, 0.76)',
          backdropFilter: 'blur(5px)',
        },
      }}
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
      <DialogTitle sx={{ pb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '1.32rem' }}>Оплата прошла успешно</Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 0.6 }}>
        <Typography sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
          Начислено +{Math.max(0, Math.trunc(coins)).toLocaleString('ru-RU')} токенов.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.3, pt: 0.4 }}>
        <Button
          onClick={onClose}
          sx={{
            minHeight: 40,
            borderRadius: 'var(--morius-radius)',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            backgroundColor: 'var(--morius-button-active)',
            color: 'var(--morius-text-primary)',
            fontWeight: 700,
            '&:hover': {
              backgroundColor: 'var(--morius-button-hover)',
            },
          }}
        >
          Отлично
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default PaymentSuccessDialog
