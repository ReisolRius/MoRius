import type { ChangeEvent, RefObject } from 'react'
import type { DialogProps } from '@mui/material'
import type { AuthUser } from '../../types/auth'
import SettingsDialog from '../settings/SettingsDialog'

type ProfileDialogProps = {
  open: boolean
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
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
  onUserUpdate?: (user: AuthUser) => void
}

function ProfileDialog({
  open,
  user,
  authToken,
  avatarInputRef,
  avatarError,
  isAvatarSaving,
  onClose,
  onChooseAvatar,
  onAvatarChange,
  onOpenTopUp,
  onRequestLogout,
  onUserUpdate,
}: ProfileDialogProps) {
  return (
    <SettingsDialog
      open={open}
      user={user}
      authToken={authToken}
      onClose={onClose}
      onLogout={onRequestLogout}
      onOpenTopUp={onOpenTopUp}
      avatarInputRef={avatarInputRef}
      avatarError={avatarError}
      isAvatarSaving={isAvatarSaving}
      onChooseAvatar={onChooseAvatar}
      onAvatarChange={onAvatarChange}
      onUserUpdate={(nextUser) => {
        onUserUpdate?.(nextUser)
      }}
    />
  )
}

export default ProfileDialog
