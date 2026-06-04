import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography, type DialogProps } from '@mui/material'
import useMobileDialogSheet from '../dialogs/useMobileDialogSheet'

type ConfirmLogoutDialogProps = {
  open: boolean
  transitionComponent?: DialogProps['TransitionComponent']
  variant?: 'default' | 'muted'
  onClose: () => void
  onConfirm: () => void
}

function ConfirmLogoutDialog({ open, transitionComponent, variant = 'default', onClose, onConfirm }: ConfirmLogoutDialogProps) {
  const mobileSheet = useMobileDialogSheet({ onClose })
  const confirmButtonStyles =
    variant === 'muted'
      ? {
          backgroundColor: 'var(--morius-card-bg)',
          color: 'var(--morius-text-primary)',
          border: 'none',
          '&:hover': { backgroundColor: 'var(--morius-button-hover)', color: 'var(--morius-title-text)' },
        }
      : {
          border: 'var(--morius-border-width) solid rgba(221, 126, 126, 0.34)',
          backgroundColor: 'rgba(175, 72, 72, 0.28)',
          color: '#ffdede',
          '&:hover': { backgroundColor: 'rgba(175, 72, 72, 0.42)', color: '#ffffff' },
        }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      TransitionComponent={transitionComponent}
      sx={mobileSheet.dialogSx}
      BackdropProps={{
        sx: mobileSheet.backdropSx,
      }}
      PaperProps={{
        ...mobileSheet.paperTouchHandlers,
        sx: {
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
          ...mobileSheet.paperSx,
        },
      }}
    >
      <DialogTitle sx={{ color: 'var(--morius-title-text)', fontWeight: 900, fontSize: '1.25rem', lineHeight: 1.25 }}>
        Подтвердите выход
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.98rem', lineHeight: 1.5 }}>
          Вы точно хотите выйти из аккаунта? После выхода вы вернетесь на страницу превью.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.2 }}>
        <Button
          onClick={onClose}
          sx={{
            color: 'var(--morius-text-secondary)',
            backgroundColor: 'var(--morius-elevated-bg)',
            '&:hover': { backgroundColor: 'var(--morius-button-hover)', color: 'var(--morius-title-text)' },
          }}
        >
          Отмена
        </Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          sx={confirmButtonStyles}
        >
          Выйти
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ConfirmLogoutDialog
