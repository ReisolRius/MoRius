import { type ChangeEvent, type RefObject } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
  type DialogProps,
} from '@mui/material'
import { icons } from '../../assets'
import type { AuthUser } from '../../types/auth'
import UserAvatar from './UserAvatar'

type ProfileDialogProps = {
  open: boolean
  user: AuthUser
  profileName: string
  avatarInputRef: RefObject<HTMLInputElement | null>
  avatarError: string
  isAvatarSaving: boolean
  transitionComponent?: DialogProps['TransitionComponent']
  onClose: () => void
  onChooseAvatar: () => void
  onAvatarChange: (event: ChangeEvent<HTMLInputElement>) => void
  onOpenTopUp: () => void
  onOpenCharacterManager: () => void
  onRequestLogout: () => void
}

function ProfileDialog({
  open,
  user,
  profileName,
  avatarInputRef,
  avatarError,
  isAvatarSaving,
  transitionComponent,
  onClose,
  onChooseAvatar,
  onAvatarChange,
  onOpenTopUp,
  onOpenCharacterManager,
  onRequestLogout,
}: ProfileDialogProps) {
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
      <DialogTitle sx={{ pb: 1.4 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '1.6rem' }}>Профиль</Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 0.2 }}>
        <Stack spacing={2.2}>
          <Stack direction="row" spacing={1.8} alignItems="center">
            <Box
              role="button"
              tabIndex={0}
              aria-label="Изменить аватар"
              onClick={onChooseAvatar}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onChooseAvatar()
                }
              }}
              sx={{
                position: 'relative',
                width: 84,
                height: 84,
                borderRadius: '50%',
                overflow: 'hidden',
                cursor: isAvatarSaving ? 'default' : 'pointer',
                outline: 'none',
                '&:hover .morius-profile-avatar-overlay': {
                  opacity: isAvatarSaving ? 0 : 1,
                },
                '&:focus-visible .morius-profile-avatar-overlay': {
                  opacity: isAvatarSaving ? 0 : 1,
                },
              }}
            >
              <UserAvatar user={user} size={84} />
              <Box
                className="morius-profile-avatar-overlay"
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(7, 11, 19, 0.58)',
                  opacity: 0,
                  transition: 'opacity 180ms ease',
                }}
              >
                <Box
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    border: 'var(--morius-border-width) solid rgba(219, 221, 231, 0.5)',
                    backgroundColor: 'rgba(17, 20, 27, 0.78)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--morius-text-primary)',
                    fontSize: '1.12rem',
                    fontWeight: 700,
                  }}
                >
                  ✎
                </Box>
              </Box>
            </Box>
            <Stack spacing={0.3} sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '1.24rem', fontWeight: 700 }}>{profileName}</Typography>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: '0.94rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user.email}
              </Typography>
            </Stack>
          </Stack>

          <input
            ref={avatarInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={onAvatarChange}
            style={{ display: 'none' }}
          />

          {avatarError ? <Alert severity="error">{avatarError}</Alert> : null}

          <Box
            sx={{
              borderRadius: '12px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-card-bg)',
              px: 1.5,
              py: 1.2,
            }}
          >
            <Stack spacing={1.3}>
              <Stack direction="row" spacing={1.1} alignItems="center">
                <Box component="img" src={icons.coin} alt="" sx={{ width: 20, height: 20, opacity: 0.92 }} />
                <Typography sx={{ fontSize: '0.98rem', color: 'text.secondary' }}>
                  Монеты: {user.coins.toLocaleString('ru-RU')}
                </Typography>
              </Stack>
              <Button
                variant="contained"
                onClick={onOpenTopUp}
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
                Пополнить баланс
              </Button>
            </Stack>
          </Box>

          <Button
            variant="outlined"
            onClick={onOpenCharacterManager}
            sx={{
              minHeight: 42,
              borderColor: 'rgba(186, 202, 214, 0.38)',
              color: 'var(--morius-text-primary)',
              '&:hover': {
                borderColor: 'rgba(206, 220, 237, 0.54)',
                backgroundColor: 'rgba(34, 45, 62, 0.32)',
              },
            }}
          >
            Мои персонажи
          </Button>

          <Button
            variant="outlined"
            onClick={onRequestLogout}
            sx={{
              minHeight: 42,
              borderColor: 'rgba(228, 120, 120, 0.44)',
              color: 'rgba(251, 190, 190, 0.92)',
              '&:hover': {
                borderColor: 'rgba(238, 148, 148, 0.72)',
                backgroundColor: 'rgba(214, 86, 86, 0.14)',
              },
            }}
          >
            Выйти из аккаунта
          </Button>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.4, pt: 0.6 }}>
        <Button
          onClick={onClose}
          sx={{
            color: 'text.secondary',
          }}
        >
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ProfileDialog
