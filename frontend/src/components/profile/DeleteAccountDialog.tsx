import { useState } from 'react'
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
  TextField,
  Typography,
} from '@mui/material'
import useMobileDialogSheet from '../dialogs/useMobileDialogSheet'

/** The word the player types to confirm. The server checks the same word. */
export const ACCOUNT_DELETE_CONFIRMATION_WORD = 'УДАЛИТЬ'

type DeleteAccountDialogProps = {
  open: boolean
  /** "self" from the settings dialog, "admin" when an administrator erases someone else. */
  subject: 'self' | 'admin'
  targetName: string
  targetEmail?: string | null
  coins?: number | null
  subscriptionTitle?: string | null
  isSubmitting: boolean
  error: string
  onClose: () => void
  onConfirm: (confirmation: string) => void
}

function formatSols(value: number): string {
  const absolute = Math.abs(Math.trunc(value))
  const lastTwo = absolute % 100
  const last = absolute % 10
  const word = lastTwo >= 11 && lastTwo <= 14 ? 'солов' : last === 1 ? 'сол' : last >= 2 && last <= 4 ? 'сола' : 'солов'
  return `${absolute.toLocaleString('ru-RU')} ${word}`
}

/**
 * The last stop before an account is erased. Spells out everything that goes with it - worlds,
 * balance, purchase history, the subscription - and only lets the button work once the player
 * has typed the confirmation word by hand.
 */
function DeleteAccountDialog({
  open,
  subject,
  targetName,
  targetEmail,
  coins,
  subscriptionTitle,
  isSubmitting,
  error,
  onClose,
  onConfirm,
}: DeleteAccountDialogProps) {
  const [confirmation, setConfirmation] = useState('')
  const handleClose = () => {
    if (!isSubmitting) {
      onClose()
    }
  }
  const mobileSheet = useMobileDialogSheet({ onClose: handleClose, disabled: isSubmitting })
  const isConfirmationTyped = confirmation.trim().toLocaleUpperCase('ru-RU') === ACCOUNT_DELETE_CONFIRMATION_WORD

  const isSelf = subject === 'self'
  const coinsLine =
    typeof coins === 'number' && coins > 0
      ? `баланс — ${formatSols(coins)} — сгорит без компенсации;`
      : 'баланс солов сгорит без компенсации;'
  const subscriptionLine = subscriptionTitle
    ? `подписка «${subscriptionTitle}» и привязанные карты: автопродление отключится, деньги за текущий период не возвращаются;`
    : 'подписки и привязанные карты: автопродление отключится, деньги за текущий период не возвращаются;'
  const consequences = [
    'все миры и истории — с их памятью, карточками и картинками;',
    'персонажи, инструкции, шаблоны карточек, места и галерея;',
    coinsLine,
    'история покупок и донатов, реферальные бонусы;',
    subscriptionLine,
    'публикации в сообществе, комментарии, оценки, подписки и уведомления.',
  ]

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      sx={mobileSheet.dialogSx}
      // Cleared once the dialog is gone, so the next time it opens the word has to be typed again.
      TransitionProps={{ onExited: () => setConfirmation('') }}
      BackdropProps={{ sx: { ...mobileSheet.backdropSx, backgroundColor: 'rgba(8, 4, 4, 0.78)', backdropFilter: 'blur(6px)' } }}
      PaperProps={{
        ...mobileSheet.paperTouchHandlers,
        sx: {
          borderRadius: '18px',
          border: '1px solid rgba(221, 110, 110, 0.38)',
          background: 'var(--morius-card-bg)',
          color: 'var(--morius-text-primary)',
          animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
          ...mobileSheet.paperSx,
        },
      }}
    >
      <DialogTitle sx={{ color: 'var(--morius-title-text)', fontWeight: 900, fontSize: '1.3rem', lineHeight: 1.25, pb: 1 }}>
        {isSelf ? 'Удалить аккаунт навсегда?' : 'Удалить аккаунт пользователя?'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.6}>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem', lineHeight: 1.55 }}>
            {isSelf ? (
              <>Это действие нельзя отменить. Вместе с аккаунтом <b>{targetName}</b> будут безвозвратно стёрты:</>
            ) : (
              <>
                Аккаунт <b>{targetName}</b>
                {targetEmail ? ` (${targetEmail})` : ''} будет удалён без возможности восстановления. Будут стёрты:
              </>
            )}
          </Typography>
          <Box
            component="ul"
            sx={{
              m: 0,
              pl: 2.4,
              color: 'var(--morius-text-primary)',
              fontSize: '0.92rem',
              lineHeight: 1.55,
              '& li + li': { mt: 0.5 },
              '& li::marker': { color: '#e07b7b' },
            }}
          >
            {consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </Box>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.86rem', lineHeight: 1.5 }}>
            {isSelf
              ? 'Повторная регистрация на эту же почту не вернёт стартовые солы.'
              : 'Пользователь потеряет доступ сразу. При повторной регистрации на ту же почту стартовые солы не выдаются.'}
          </Typography>
          <TextField
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value.slice(0, 40))}
            label={`Введите ${ACCOUNT_DELETE_CONFIRMATION_WORD}, чтобы подтвердить`}
            autoComplete="off"
            disabled={isSubmitting}
            fullWidth
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px', backgroundColor: 'var(--morius-elevated-bg)' } }}
          />
          {error ? <Alert severity="error" sx={{ borderRadius: '12px' }}>{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.4, gap: 1 }}>
        <Button
          onClick={handleClose}
          disabled={isSubmitting}
          sx={{
            color: 'var(--morius-text-secondary)',
            backgroundColor: 'var(--morius-elevated-bg)',
            textTransform: 'none',
            borderRadius: '11px',
            px: 2,
            '&:hover': { backgroundColor: 'var(--morius-button-hover)', color: 'var(--morius-title-text)' },
          }}
        >
          Отмена
        </Button>
        <Button
          onClick={() => onConfirm(confirmation.trim())}
          disabled={!isConfirmationTyped || isSubmitting}
          sx={{
            minWidth: 176,
            textTransform: 'none',
            fontWeight: 800,
            borderRadius: '11px',
            px: 2,
            border: '1px solid rgba(221, 110, 110, 0.5)',
            backgroundColor: 'rgba(180, 60, 60, 0.32)',
            color: '#ffe3e3',
            '&:hover': { backgroundColor: 'rgba(190, 64, 64, 0.5)', color: '#ffffff' },
            '&.Mui-disabled': { color: 'rgba(255, 227, 227, 0.4)', borderColor: 'rgba(221, 110, 110, 0.2)' },
          }}
        >
          {isSubmitting ? <CircularProgress size={18} sx={{ color: '#ffe3e3' }} /> : 'Удалить навсегда'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default DeleteAccountDialog
