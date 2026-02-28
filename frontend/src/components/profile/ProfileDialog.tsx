import { useEffect, useState, type ChangeEvent, type RefObject } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  SvgIcon,
  TextField,
  Typography,
  type DialogProps,
} from '@mui/material'
import { icons } from '../../assets'
import type { AuthUser } from '../../types/auth'
import TextLimitIndicator from '../TextLimitIndicator'
import AdminPanelDialog, { ADMIN_PANEL_EMAIL_ALLOWLIST } from './AdminPanelDialog'
import UserAvatar from './UserAvatar'

const PROFILE_NAME_MAX_LENGTH = 25

type ProfileDialogProps = {
  open: boolean
  user: AuthUser
  authToken: string
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
  onOpenInstructionTemplates: () => void
  onRequestLogout: () => void
  onUpdateProfileName: (nextName: string) => Promise<void>
}

function ProfileDialog({
  open,
  user,
  authToken,
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
  onOpenInstructionTemplates,
  onRequestLogout,
  onUpdateProfileName,
}: ProfileDialogProps) {
  const [isProfileNameEditing, setIsProfileNameEditing] = useState(false)
  const [profileNameDraft, setProfileNameDraft] = useState(profileName)
  const [isProfileNameSaving, setIsProfileNameSaving] = useState(false)
  const [profileNameError, setProfileNameError] = useState('')
  const [adminDialogOpen, setAdminDialogOpen] = useState(false)
  const canOpenAdminPanel =
    ADMIN_PANEL_EMAIL_ALLOWLIST.has(user.email.trim().toLowerCase()) &&
    (user.role === 'administrator' || user.role === 'moderator')

  useEffect(() => {
    if (!open) {
      setIsProfileNameEditing(false)
      setProfileNameError('')
      setProfileNameDraft(profileName)
      setAdminDialogOpen(false)
      return
    }
    if (!isProfileNameEditing) {
      setProfileNameDraft(profileName)
    }
  }, [isProfileNameEditing, open, profileName])

  const handleStartProfileNameEdit = () => {
    if (isProfileNameSaving) {
      return
    }
    setIsProfileNameEditing(true)
    setProfileNameError('')
    setProfileNameDraft(profileName)
  }

  const handleCancelProfileNameEdit = () => {
    if (isProfileNameSaving) {
      return
    }
    setIsProfileNameEditing(false)
    setProfileNameError('')
    setProfileNameDraft(profileName)
  }

  const handleSaveProfileName = async () => {
    if (isProfileNameSaving) {
      return
    }
    const normalizedName = profileNameDraft.trim()
    if (!normalizedName) {
      setProfileNameError('Введите никнейм.')
      return
    }
    if (normalizedName.length > PROFILE_NAME_MAX_LENGTH) {
      setProfileNameError(`Максимум ${PROFILE_NAME_MAX_LENGTH} символов.`)
      return
    }

    setProfileNameError('')
    setIsProfileNameSaving(true)
    try {
      await onUpdateProfileName(normalizedName)
      setIsProfileNameEditing(false)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить никнейм'
      setProfileNameError(detail)
    } finally {
      setIsProfileNameSaving(false)
    }
  }

  return (
    <>
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
            <Stack spacing={0.4} sx={{ minWidth: 0, flex: 1 }}>
              {isProfileNameEditing ? (
                <Stack spacing={0.8}>
                  <TextField
                    value={profileNameDraft}
                    autoFocus
                    size="small"
                    disabled={isProfileNameSaving}
                    onChange={(event) => {
                      setProfileNameDraft(event.target.value.slice(0, PROFILE_NAME_MAX_LENGTH))
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void handleSaveProfileName()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        handleCancelProfileNameEdit()
                      }
                    }}
                    inputProps={{
                      maxLength: PROFILE_NAME_MAX_LENGTH,
                    }}
                    helperText={<TextLimitIndicator currentLength={profileNameDraft.length} maxLength={PROFILE_NAME_MAX_LENGTH} />}
                    FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        backgroundColor: 'rgba(12, 17, 27, 0.72)',
                      },
                    }}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="text"
                      onClick={handleCancelProfileNameEdit}
                      disabled={isProfileNameSaving}
                      sx={{ minHeight: 30, px: 1.05, color: 'text.secondary' }}
                    >
                      Отмена
                    </Button>
                    <Button
                      variant="contained"
                      onClick={() => void handleSaveProfileName()}
                      disabled={isProfileNameSaving}
                      sx={{
                        minHeight: 30,
                        px: 1.15,
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
                      {isProfileNameSaving ? (
                        <CircularProgress size={15} sx={{ color: 'var(--morius-text-primary)' }} />
                      ) : (
                        'Сохранить'
                      )}
                    </Button>
                  </Stack>
                </Stack>
              ) : (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    columnGap: 0.6,
                    minWidth: 0,
                    '& .morius-profile-name-edit': {
                      opacity: 0,
                      pointerEvents: 'none',
                      transform: 'translateX(2px)',
                    },
                    '&:hover .morius-profile-name-edit, &:focus-within .morius-profile-name-edit': {
                      opacity: 1,
                      pointerEvents: 'auto',
                      transform: 'translateX(0)',
                    },
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: '1.24rem',
                      fontWeight: 700,
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {profileName}
                  </Typography>
                  <IconButton
                    className="morius-profile-name-edit"
                    size="small"
                    aria-label="Редактировать никнейм"
                    onClick={handleStartProfileNameEdit}
                    sx={{
                      width: 30,
                      height: 30,
                      border: 'var(--morius-border-width) solid rgba(195, 204, 218, 0.32)',
                      color: 'var(--morius-text-secondary)',
                      transition: 'opacity 180ms ease, transform 180ms ease',
                      '&:hover': {
                        color: 'var(--morius-text-primary)',
                        borderColor: 'rgba(220, 229, 244, 0.55)',
                        backgroundColor: 'rgba(33, 45, 61, 0.42)',
                      },
                    }}
                  >
                    <SvgIcon sx={{ width: 17, height: 17 }}>
                      <path d="M3 17.25V21h3.75l11.06-11.06-3.75-3.75L3 17.25zm2.41 2.34H5.5v-.91l8.17-8.17.91.91-8.17 8.17zm12.53-10.2 1.77-1.77a1 1 0 0 0 0-1.41l-2.31-2.31a1 1 0 0 0-1.41 0L14.22 5.7l3.72 3.69z" />
                    </SvgIcon>
                  </IconButton>
                </Box>
              )}
              {profileNameError ? <Alert severity="error">{profileNameError}</Alert> : null}
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
                  Солы: {user.coins.toLocaleString('ru-RU')}
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
            onClick={onOpenInstructionTemplates}
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
            {'\u041c\u043e\u0438 \u0448\u0430\u0431\u043b\u043e\u043d\u044b \u0438\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0438\u0439'}
          </Button>

          {canOpenAdminPanel ? (
            <Button
              variant="outlined"
              onClick={() => setAdminDialogOpen(true)}
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
              Админка
            </Button>
          ) : null}

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
      <AdminPanelDialog
        open={adminDialogOpen}
        authToken={authToken}
        currentUserEmail={user.email}
        onClose={() => setAdminDialogOpen(false)}
      />
    </>
  )
}

export default ProfileDialog

