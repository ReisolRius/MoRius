import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography, type DialogProps } from '@mui/material'
import useMobileDialogSheet from '../dialogs/useMobileDialogSheet'

type PaymentSuccessDialogProps = {
  open: boolean
  coins: number
  onClose: () => void
  transitionComponent?: DialogProps['TransitionComponent']
}

function PaymentSuccessDialog({ open, coins, onClose, transitionComponent }: PaymentSuccessDialogProps) {
  const mobileSheet = useMobileDialogSheet({ onClose })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      TransitionComponent={transitionComponent}
      sx={mobileSheet.dialogSx}
      BackdropProps={{
        sx: {
          ...mobileSheet.backdropSx,
          backgroundColor: 'rgba(1, 4, 8, 0.88)',
        },
      }}
      PaperProps={{
        ...mobileSheet.paperTouchHandlers,
        sx: {
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
          ...mobileSheet.paperSx,
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '1.32rem' }}>Оплата прошла успешно</Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 0.6 }}>
        <Typography sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
          Начислено +{Math.max(0, Math.trunc(coins)).toLocaleString('ru-RU')} солов.
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
              backgroundColor: 'transparent',
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
