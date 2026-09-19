import { useEffect, useMemo, useState, type ChangeEvent, type RefObject } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Switch,
  TextField,
  Typography,
  type DialogProps,
} from '@mui/material'
import editIconMarkup from '../../assets/icons/community-edit.svg?raw'
import {
  deleteCurrentAccount,
  getShopCatalog,
  replaceCurrentAuthWithPassword,
  startVKIDOAuth,
  startYandexOAuth,
  updateCurrentUserProfile,
  updateCurrentUserProfilePrivacy,
  type CosmeticItem,
} from '../../services/authApi'
import type { AuthUser } from '../../types/auth'
import { getProfileBannerPreset, normalizeProfileBannerId, PROFILE_BANNER_PRESETS } from '../../constants/profileBanners'
import { resolveProfileBannerImageUrl, withKnownCosmeticImageUrl } from '../../utils/cosmeticImageFallbacks'
import { AVATAR_FRAME_PRESETS, normalizeAvatarFrameId } from '../../constants/avatarFrames'
import useMobileDialogSheet from '../dialogs/useMobileDialogSheet'
import ThemedSvgIcon from '../icons/ThemedSvgIcon'
import ProgressiveImage from '../media/ProgressiveImage'
import AvatarFrame from '../profile/AvatarFrame'
import DeleteAccountDialog from '../profile/DeleteAccountDialog'
import UserAvatar from '../profile/UserAvatar'
import { notifyAccountDeleted, requestAccount } from '../../utils/guestSession'

type SettingsDialogProps = {
  open: boolean
  user: AuthUser
  authToken: string
  onClose: () => void
  onLogout: () => void
  onUserUpdate: (user: AuthUser) => void
  onOpenTopUp?: () => void
  avatarInputRef?: RefObject<HTMLInputElement | null>
  avatarError?: string
  isAvatarSaving?: boolean
  onChooseAvatar?: () => void
  onAvatarChange?: (event: ChangeEvent<HTMLInputElement>) => void
}

type SettingsTabId = 'profile' | 'appearance' | 'privacy' | 'notifications'
type AccountAuthProvider = 'email' | 'google' | 'yandex' | 'vk' | 'mail'

const PROFILE_DESCRIPTION_MAX = 4000
const DISPLAY_NAME_MAX = 120
const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'profile', label: 'Профиль' },
  { id: 'appearance', label: 'Оформление' },
  { id: 'privacy', label: 'Приватность' },
  { id: 'notifications', label: 'Уведомления' },
]
const NOTIFICATION_FIELDS = [
  { key: 'notifications_enabled', label: 'Показывать уведомления в профиле' },
  { key: 'notify_comment_reply', label: 'Ответы на комментарии' },
  { key: 'notify_world_comment', label: 'Комментарии к мирам' },
  { key: 'notify_publication_review', label: 'Модерация публикаций' },
  { key: 'notify_new_follower', label: 'Новые подписчики' },
  { key: 'notify_moderation_report', label: 'Жалобы и moderation reports' },
  { key: 'notify_moderation_queue', label: 'Очередь модерации' },
  { key: 'email_notifications_enabled', label: 'Дублировать на почту' },
] as const
const PRIVACY_FIELDS = [
  { key: 'show_subscriptions', label: 'Показывать подписки' },
  { key: 'show_public_worlds', label: 'Показывать публичные миры' },
  { key: 'show_private_worlds', label: 'Показывать приватные миры' },
  { key: 'show_public_characters', label: 'Показывать персонажей' },
  { key: 'show_public_instruction_templates', label: 'Показывать инструкции' },
] as const

function resolveActiveAuthProvider(value: string): AccountAuthProvider {
  const providers = new Set(value.split('+').map((item) => item.trim().toLowerCase()).filter(Boolean))
  if (providers.has('mail')) return 'mail'
  if (providers.has('vk')) return 'vk'
  if (providers.has('yandex')) return 'yandex'
  if (providers.has('email')) return 'email'
  return providers.has('google') ? 'google' : 'email'
}

const AUTH_PROVIDER_LABELS: Record<AccountAuthProvider, string> = {
  email: 'Почта и пароль',
  google: 'Google',
  yandex: 'Яндекс',
  vk: 'VK',
  mail: 'Mail',
}


function SettingsSwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.4}>
      <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.95rem', lineHeight: 1.3 }}>{label}</Typography>
      <Switch
        checked={checked}
        color="default"
        onChange={(event) => onChange(event.target.checked)}
        sx={{
          mr: -0.7,
          '& .MuiSwitch-switchBase.Mui-checked': {
            color: 'var(--morius-accent)',
          },
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
            backgroundColor: 'var(--morius-accent)',
            opacity: 0.92,
          },
        }}
      />
    </Stack>
  )
}

function SettingsDialog({
  open,
  user,
  authToken,
  onClose,
  onLogout,
  onUserUpdate,
  avatarInputRef,
  avatarError = '',
  isAvatarSaving = false,
  onChooseAvatar,
  onAvatarChange,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('appearance')
  const [error, setError] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [displayName, setDisplayName] = useState(user.display_name ?? '')
  const [profileDescription, setProfileDescription] = useState(user.profile_description ?? '')
  const [profileBannerId, setProfileBannerId] = useState(() => normalizeProfileBannerId(user.profile_banner_id))
  const [avatarFrameId, setAvatarFrameId] = useState(() => normalizeAvatarFrameId(user.avatar_frame_id))
  const [ownedShopCosmetics, setOwnedShopCosmetics] = useState<{ avatar_frames: CosmeticItem[]; profile_banners: CosmeticItem[] }>({
    avatar_frames: [],
    profile_banners: [],
  })
  const [notifications, setNotifications] = useState({
    notifications_enabled: user.notifications_enabled ?? true,
    notify_comment_reply: user.notify_comment_reply ?? true,
    notify_world_comment: user.notify_world_comment ?? true,
    notify_publication_review: user.notify_publication_review ?? true,
    notify_new_follower: user.notify_new_follower ?? true,
    notify_moderation_report: user.notify_moderation_report ?? false,
    notify_moderation_queue: user.notify_moderation_queue ?? false,
    email_notifications_enabled: user.email_notifications_enabled ?? false,
  })
  const [aiAssistantVisible, setAiAssistantVisible] = useState(user.ai_assistant_visible ?? true)
  const [privacy, setPrivacy] = useState({
    show_subscriptions: user.show_subscriptions ?? false,
    show_public_worlds: user.show_public_worlds ?? false,
    show_private_worlds: user.show_private_worlds ?? false,
    show_public_characters: user.show_public_characters ?? false,
    show_public_instruction_templates: user.show_public_instruction_templates ?? false,
  })
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)
  const [isPasswordAuthDialogOpen, setIsPasswordAuthDialogOpen] = useState(false)
  const [passwordAuthValue, setPasswordAuthValue] = useState('')
  const [passwordAuthConfirmValue, setPasswordAuthConfirmValue] = useState('')
  const [isReplacingAuthMethod, setIsReplacingAuthMethod] = useState(false)
  const [isStartingYandexLink, setIsStartingYandexLink] = useState(false)
  const [vkIDLinkProvider, setVKIDLinkProvider] = useState<'vk' | 'mail' | null>(null)
  const [authMethodSuccess, setAuthMethodSuccess] = useState('')
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false)
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [deleteAccountError, setDeleteAccountError] = useState('')
  const activeAuthProvider = resolveActiveAuthProvider(user.auth_provider || 'email')
  const isAuthMethodBusy = isStartingYandexLink || vkIDLinkProvider !== null || isReplacingAuthMethod
  const isGuest = Boolean(user.is_guest)
  // Every "Настройки" button in the app ends here, so this is where a guest is turned away.
  const isOpen = open && !isGuest

  useEffect(() => {
    if (!open || !isGuest) {
      return
    }
    onClose()
    requestAccount('settings')
  }, [isGuest, onClose, open])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    setActiveTab('profile')
    setAuthMethodSuccess('')
    setPasswordAuthValue('')
    setPasswordAuthConfirmValue('')
    setIsPasswordAuthDialogOpen(false)
    setVKIDLinkProvider(null)
    setDisplayName(user.display_name ?? '')
    setProfileDescription(user.profile_description ?? '')
    setProfileBannerId(normalizeProfileBannerId(user.profile_banner_id))
    setAvatarFrameId(normalizeAvatarFrameId(user.avatar_frame_id))
    setNotifications({
      notifications_enabled: user.notifications_enabled ?? true,
      notify_comment_reply: user.notify_comment_reply ?? true,
      notify_world_comment: user.notify_world_comment ?? true,
      notify_publication_review: user.notify_publication_review ?? true,
      notify_new_follower: user.notify_new_follower ?? true,
      notify_moderation_report: user.notify_moderation_report ?? false,
      notify_moderation_queue: user.notify_moderation_queue ?? false,
      email_notifications_enabled: user.email_notifications_enabled ?? false,
    })
    setAiAssistantVisible(user.ai_assistant_visible ?? true)
    setPrivacy({
      show_subscriptions: user.show_subscriptions ?? false,
      show_public_worlds: user.show_public_worlds ?? false,
      show_private_worlds: user.show_private_worlds ?? false,
      show_public_characters: user.show_public_characters ?? false,
      show_public_instruction_templates: user.show_public_instruction_templates ?? false,
    })
  }, [isOpen, user])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    let ignore = false
    void getShopCatalog({ token: authToken })
      .then((response) => {
        if (ignore) {
          return
        }
        setOwnedShopCosmetics({
          avatar_frames: response.avatar_frames.filter((item) => item.is_owned).map(withKnownCosmeticImageUrl),
          profile_banners: response.profile_banners.filter((item) => item.is_owned).map(withKnownCosmeticImageUrl),
        })
      })
      .catch(() => {
        if (!ignore) {
          setOwnedShopCosmetics({ avatar_frames: [], profile_banners: [] })
        }
      })
    return () => {
      ignore = true
    }
  }, [authToken, isOpen])

  const hasProfileUnsavedChanges = useMemo(() => (
    displayName !== (user.display_name ?? '') ||
    profileDescription !== (user.profile_description ?? '') ||
    profileBannerId !== normalizeProfileBannerId(user.profile_banner_id) ||
    avatarFrameId !== normalizeAvatarFrameId(user.avatar_frame_id) ||
    notifications.notifications_enabled !== (user.notifications_enabled ?? true) ||
    notifications.notify_comment_reply !== (user.notify_comment_reply ?? true) ||
    notifications.notify_world_comment !== (user.notify_world_comment ?? true) ||
    notifications.notify_publication_review !== (user.notify_publication_review ?? true) ||
    notifications.notify_new_follower !== (user.notify_new_follower ?? true) ||
    notifications.notify_moderation_report !== (user.notify_moderation_report ?? false) ||
    notifications.notify_moderation_queue !== (user.notify_moderation_queue ?? false) ||
    notifications.email_notifications_enabled !== (user.email_notifications_enabled ?? false) ||
    aiAssistantVisible !== (user.ai_assistant_visible ?? true) ||
    privacy.show_subscriptions !== (user.show_subscriptions ?? false) ||
    privacy.show_public_worlds !== (user.show_public_worlds ?? false) ||
    privacy.show_private_worlds !== (user.show_private_worlds ?? false) ||
    privacy.show_public_characters !== (user.show_public_characters ?? false) ||
    privacy.show_public_instruction_templates !== (user.show_public_instruction_templates ?? false)
  ), [aiAssistantVisible, avatarFrameId, displayName, notifications, privacy, profileBannerId, profileDescription, user])

  const hasUnsavedChanges = hasProfileUnsavedChanges

  const closeDialogWithoutPrompt = () => {
    setIsCloseConfirmOpen(false)
    setError('')
    onClose()
  }

  const requestDialogClose = () => {
    if (hasUnsavedChanges) {
      setIsCloseConfirmOpen(true)
      return
    }
    closeDialogWithoutPrompt()
  }

  const handleDialogClose: DialogProps['onClose'] = (_event, reason) => {
    if (reason === 'backdropClick') {
      return
    }
    requestDialogClose()
  }
  const mobileSheet = useMobileDialogSheet({ onClose: requestDialogClose })

  const handleStartYandexLink = async () => {
    if (isAuthMethodBusy || activeAuthProvider === 'yandex') {
      return
    }
    setError('')
    setAuthMethodSuccess('')
    setIsStartingYandexLink(true)
    try {
      const response = await startYandexOAuth({
        action: 'link',
        return_path: '/profile',
        token: authToken,
      })
      window.location.assign(response.authorization_url)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось начать перепривязку к Яндексу')
      setIsStartingYandexLink(false)
    }
  }

  const handleStartVKIDLink = async (provider: 'vk' | 'mail') => {
    if (isAuthMethodBusy || activeAuthProvider === provider) {
      return
    }
    setError('')
    setAuthMethodSuccess('')
    setVKIDLinkProvider(provider)
    try {
      const response = await startVKIDOAuth({
        action: 'link',
        provider,
        return_path: '/profile',
        token: authToken,
      })
      window.location.assign(response.authorization_url)
    } catch (requestError) {
      const providerLabel = provider === 'mail' ? 'Mail' : 'VK'
      setError(requestError instanceof Error ? requestError.message : `Не удалось начать перепривязку к ${providerLabel}`)
      setVKIDLinkProvider(null)
    }
  }

  const handleReplaceAuthWithPassword = async () => {
    if (isAuthMethodBusy || activeAuthProvider === 'email') {
      return
    }
    if (passwordAuthValue.length < 8) {
      setError('Пароль должен быть не короче 8 символов')
      return
    }
    if (passwordAuthValue !== passwordAuthConfirmValue) {
      setError('Пароли не совпадают')
      return
    }
    setError('')
    setAuthMethodSuccess('')
    setIsReplacingAuthMethod(true)
    try {
      const updatedUser = await replaceCurrentAuthWithPassword({
        token: authToken,
        password: passwordAuthValue,
        confirm_password: passwordAuthConfirmValue,
      })
      onUserUpdate(updatedUser)
      setPasswordAuthValue('')
      setPasswordAuthConfirmValue('')
      setIsPasswordAuthDialogOpen(false)
      setAuthMethodSuccess(`Теперь вход выполняется по адресу ${updatedUser.email} и паролю.`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось изменить способ входа')
    } finally {
      setIsReplacingAuthMethod(false)
    }
  }

  const handleSaveProfile = async () => {
    if (isSavingProfile) {
      return
    }
    const nextDisplayName = displayName.trim()
    const nextDescription = profileDescription.trim()
    if (!nextDisplayName) {
      setError('Отображаемое имя не может быть пустым')
      return
    }
    setError('')
    setIsSavingProfile(true)
    try {
      const updatedUser = await updateCurrentUserProfile({
        token: authToken,
        display_name: nextDisplayName,
        profile_description: nextDescription,
        profile_banner_id: profileBannerId,
        avatar_frame_id: avatarFrameId,
        notifications_enabled: notifications.notifications_enabled,
        notify_comment_reply: notifications.notify_comment_reply,
        notify_world_comment: notifications.notify_world_comment,
        notify_publication_review: notifications.notify_publication_review,
        notify_new_follower: notifications.notify_new_follower,
        notify_moderation_report: notifications.notify_moderation_report,
        notify_moderation_queue: notifications.notify_moderation_queue,
        ai_assistant_visible: aiAssistantVisible,
        email_notifications_enabled: notifications.email_notifications_enabled,
      })
      const updatedPrivacy = await updateCurrentUserProfilePrivacy({
        token: authToken,
        show_subscriptions: privacy.show_subscriptions,
        show_public_worlds: privacy.show_public_worlds,
        show_private_worlds: privacy.show_private_worlds,
        show_public_characters: privacy.show_public_characters,
        show_public_instruction_templates: privacy.show_public_instruction_templates,
      })
      onUserUpdate({ ...updatedUser, ...updatedPrivacy })
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось сохранить профиль'
      setError(detail)
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleDeleteAccount = async (confirmation: string) => {
    if (isDeletingAccount) {
      return
    }
    setDeleteAccountError('')
    setIsDeletingAccount(true)
    try {
      await deleteCurrentAccount({ token: authToken, confirmation })
      setIsDeleteAccountOpen(false)
      onClose()
      notifyAccountDeleted()
    } catch (requestError) {
      setDeleteAccountError(requestError instanceof Error ? requestError.message : 'Не удалось удалить аккаунт')
    } finally {
      setIsDeletingAccount(false)
    }
  }

  const previewDescription = profileDescription.trim() || 'Краткое описание профиля'
  const selectedProfileBanner = useMemo(() => getProfileBannerPreset(profileBannerId), [profileBannerId])
  const selectedOwnedProfileBanner = useMemo(
    () => ownedShopCosmetics.profile_banners.find((item) => item.selection_id === profileBannerId) ?? null,
    [ownedShopCosmetics.profile_banners, profileBannerId],
  )
  const selectedOwnedAvatarFrame = useMemo(
    () => ownedShopCosmetics.avatar_frames.find((item) => item.selection_id === avatarFrameId) ?? null,
    [avatarFrameId, ownedShopCosmetics.avatar_frames],
  )
  const selectedProfileBannerSrc =
    resolveProfileBannerImageUrl(profileBannerId, selectedOwnedProfileBanner?.image_url ?? null) ?? selectedProfileBanner.src
  const selectedProfileBannerObjectPosition = selectedOwnedProfileBanner ? 'center center' : selectedProfileBanner.objectPosition
  const previewAvatarUser = useMemo(() => ({ ...user, avatar_frame_id: 'none', avatar_frame_image_url: null }), [user])

  return (
    <Dialog
      open={isOpen}
      onClose={handleDialogClose}
      fullWidth
      maxWidth={false}
      sx={mobileSheet.dialogSx}
      BackdropProps={{
        sx: {
          ...mobileSheet.backdropSx,
          backgroundColor: 'rgba(14, 15, 19, 0.76)',
          backdropFilter: 'blur(10px)',
        },
      }}
      PaperProps={{
        ...mobileSheet.paperTouchHandlers,
        sx: {
          width: 'min(860px, calc(100vw - 24px))',
          maxWidth: 'none',
          height: 'min(760px, calc(100vh - 24px))',
          maxHeight: '88vh',
          borderRadius: '22px',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'linear-gradient(170deg, color-mix(in srgb, var(--morius-elevated-bg) 88%, #3a4050 12%), var(--morius-card-bg))',
          color: 'var(--morius-text-primary)',
          overflow: 'hidden',
          boxShadow: '0 40px 90px -40px rgba(0,0,0,0.95)',
          ...mobileSheet.paperSx,
        },
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr) auto',
          height: '100%',
          minHeight: 0,
          background: 'linear-gradient(170deg, color-mix(in srgb, var(--morius-elevated-bg) 86%, #3a4050 14%), var(--morius-card-bg))',
        }}
      >
        <Box
          sx={{
            px: mobileSheet.isMobileSheet ? 1.3 : 2.75,
            py: mobileSheet.isMobileSheet ? 1.1 : 1.8,
            borderBottom: 'var(--morius-border-width) solid var(--morius-card-border)',
            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 72%, var(--morius-card-bg) 28%)',
            zIndex: 2,
          }}
        >
          <Stack direction="row" spacing={1.2} alignItems="center" justifyContent="space-between">
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                sx={{
                  color: 'var(--morius-title-text)',
                  fontFamily: 'var(--morius-font-heading)',
                  fontSize: mobileSheet.isMobileSheet ? '1.35rem' : '1.45rem',
                  fontWeight: 650,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                Оформление профиля
              </Typography>
            </Stack>
            <Button
              onClick={requestDialogClose}
              disableRipple
              sx={{
                minWidth: 42,
                width: 42,
                height: 42,
                p: 0,
                borderRadius: '10px',
                border: 'none',
                color: 'color-mix(in srgb, var(--morius-title-text) 76%, black 24%)',
                backgroundColor: 'transparent',
                fontSize: '1.8rem',
                fontWeight: 700,
                lineHeight: 1,
                flexShrink: 0,
                '&:hover': {
                  backgroundColor: 'var(--morius-button-hover)',
                  color: 'var(--morius-title-text)',
                },
              }}
            >
              ×
            </Button>
          </Stack>
        </Box>

        <DialogContent sx={{ p: 0, minHeight: 0, overflow: 'hidden', backgroundColor: 'transparent' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '184px minmax(0, 1fr)' },
            gridTemplateRows: { xs: 'auto minmax(0, 1fr)', md: 'minmax(0, 1fr)' },
            height: '100%',
            minHeight: 0,
          }}
        >
          <Box
            sx={{
              display: 'block',
              borderRight: { xs: 'none', md: 'var(--morius-border-width) solid var(--morius-card-border)' },
              borderBottom: mobileSheet.isMobileSheet
                ? 'var(--morius-border-width) solid var(--morius-card-border)'
                : { xs: 'var(--morius-border-width) solid var(--morius-card-border)', md: 'none' },
              backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 52%, transparent)',
              position: mobileSheet.isMobileSheet ? 'static' : { md: 'sticky' },
              top: 0,
              alignSelf: mobileSheet.isMobileSheet ? 'stretch' : 'start',
              height: mobileSheet.isMobileSheet ? 'auto' : { md: '100%' },
            }}
          >
            <Stack spacing={1.2} sx={{ p: mobileSheet.isMobileSheet ? 1.05 : '14px 12px' }}>
              <Typography
                sx={{
                  display: 'none',
                  color: 'var(--morius-title-text)',
                  fontSize: mobileSheet.isMobileSheet ? '1.55rem' : '2rem',
                  fontWeight: 900,
                }}
              >
                Настройки
              </Typography>
              <Stack
                direction={mobileSheet.isMobileSheet ? 'row' : 'column'}
                spacing={0.5}
                sx={{
                  overflowX: mobileSheet.isMobileSheet ? 'auto' : 'visible',
                  pb: mobileSheet.isMobileSheet ? 0.1 : 0,
                  pr: mobileSheet.isMobileSheet ? 0.1 : 0,
                  scrollbarWidth: 'none',
                  '&::-webkit-scrollbar': {
                    display: 'none',
                  },
                }}
              >
                {SETTINGS_TABS.map((tab) => {
                  const isActive = activeTab === tab.id
                  return (
                    <Button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      sx={{
                        minHeight: mobileSheet.isMobileSheet ? 42 : 38,
                        minWidth: mobileSheet.isMobileSheet ? 'fit-content' : '100%',
                        justifyContent: 'flex-start',
                        px: 1.5,
                        borderRadius: '10px',
                        textTransform: 'none',
                        fontSize: '0.86rem',
                        fontWeight: isActive ? 750 : 650,
                        color: isActive ? 'var(--morius-title-text)' : 'var(--morius-text-secondary)',
                        border: 'none',
                        backgroundColor: isActive ? 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #ffffff 18%)' : 'transparent',
                        '&:hover': {
                          backgroundColor: isActive ? 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #ffffff 18%)' : 'color-mix(in srgb, var(--morius-button-hover) 52%, transparent)',
                        },
                      }}
                    >
                      {tab.label}
                    </Button>
                  )
                })}
              </Stack>
            </Stack>
          </Box>

          <Box
            className="morius-scrollbar"
            sx={{
              minWidth: 0,
              minHeight: 0,
              overflowY: 'auto',
              p: mobileSheet.isMobileSheet ? 1.2 : { xs: 1.35, md: '20px 22px 22px' },
              backgroundColor: 'transparent',
            }}
          >
            {error ? <Alert severity="error" onClose={() => setError('')} sx={{ mb: 1.4, borderRadius: '14px' }}>{error}</Alert> : null}
            {avatarError ? <Alert severity="error" sx={{ mb: 1.4, borderRadius: '14px' }}>{avatarError}</Alert> : null}

            <Stack spacing={1.45}>
                {activeTab === 'appearance' ? (
                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.68rem', fontWeight: 750, letterSpacing: '0.13em', textTransform: 'uppercase' }}>
                    Предпросмотр
                  </Typography>
                ) : null}

                <Box
                  sx={{
                    display: activeTab === 'appearance' ? 'block' : 'none',
                    position: 'relative',
                    overflow: 'hidden',
                    minHeight: 158,
                    borderRadius: '16px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-card-bg)',
                    p: 0,
                  }}
                >
                  <ProgressiveImage
                    src={selectedProfileBannerSrc}
                    alt=""
                    objectFit="cover"
                    objectPosition={selectedProfileBannerObjectPosition}
                    loaderSize={24}
                    fallback={<Box sx={{ position: 'absolute', inset: 0, backgroundColor: 'var(--morius-card-bg)' }} />}
                    containerSx={{
                      position: 'absolute',
                      inset: '0 0 auto 0',
                      width: '100%',
                      height: 104,
                      backgroundColor: 'var(--morius-card-bg)',
                    }}
                  />
                  <Box
                    aria-hidden
                    sx={{
                      position: 'absolute',
                      inset: '0 0 auto 0',
                      height: 104,
                      zIndex: 1,
                      background:
                        'linear-gradient(90deg, rgba(5, 8, 12, 0.12) 0%, rgba(5, 8, 12, 0.03) 58%, rgba(5, 8, 12, 0.14) 100%), linear-gradient(0deg, rgba(5, 8, 12, 0.32) 0%, rgba(5, 8, 12, 0.02) 100%)',
                    }}
                  />
                  <Stack
                    direction="row"
                    spacing={1.4}
                    alignItems="flex-end"
                    sx={{ position: 'absolute', zIndex: 2, left: 18, right: 18, bottom: 15, minHeight: 62 }}
                  >
                    <Box
                      sx={{
                        position: 'relative',
                        width: 62,
                        height: 62,
                        flexShrink: 0,
                        borderRadius: '50%',
                        boxShadow: '0 0 0 3px color-mix(in srgb, var(--morius-accent) 62%, var(--morius-title-text)), 0 0 0 6px var(--morius-card-bg), 0 12px 24px rgba(0,0,0,0.28)',
                      }}
                    >
                      {onChooseAvatar ? (
                        <Button
                          onClick={onChooseAvatar}
                          disabled={isAvatarSaving}
                          disableRipple
                          sx={{
                            minWidth: 0,
                            width: 62,
                            height: 62,
                            p: 0,
                            borderRadius: '50%',
                            overflow: 'visible',
                            position: 'relative',
                            backgroundColor: 'transparent',
                            '&:hover': {
                              backgroundColor: 'transparent',
                            },
                            '& .morius-settings-avatar-overlay': {
                              opacity: isAvatarSaving ? 1 : 0,
                            },
                            '&:hover .morius-settings-avatar-overlay, &:focus-visible .morius-settings-avatar-overlay': {
                              opacity: 1,
                            },
                          }}
                        >
                          <AvatarFrame frameId={avatarFrameId} frameImageUrl={selectedOwnedAvatarFrame?.image_url ?? null} size={62}>
                            <UserAvatar user={previewAvatarUser} size={62} withFrame={false} />
                          </AvatarFrame>
                          <Box
                            className="morius-settings-avatar-overlay"
                            sx={{
                              position: 'absolute',
                              inset: 0,
                              borderRadius: '50%',
                              display: 'grid',
                              placeItems: 'center',
                              backgroundColor: 'rgba(5, 7, 10, 0.58)',
                              color: 'var(--morius-title-text)',
                              transition: 'opacity 160ms ease',
                              pointerEvents: 'none',
                            }}
                          >
                            <ThemedSvgIcon markup={editIconMarkup} size={20} sx={{ color: 'var(--morius-title-text)' }} />
                          </Box>
                        </Button>
                      ) : (
                        <AvatarFrame frameId={avatarFrameId} frameImageUrl={selectedOwnedAvatarFrame?.image_url ?? null} size={62}>
                          <UserAvatar user={previewAvatarUser} size={62} withFrame={false} />
                        </AvatarFrame>
                      )}
                      {avatarInputRef && onAvatarChange ? <Box component="input" ref={avatarInputRef} type="file" accept="image/*" onChange={onAvatarChange} sx={{ display: 'none' }} /> : null}
                    </Box>

                    <Stack spacing={0.18} sx={{ minWidth: 0, flex: 1, pb: 0.15 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.08rem', fontWeight: 800, lineHeight: 1.1 }}>{displayName.trim() || 'Игрок'}</Typography>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {previewDescription}
                      </Typography>
                    </Stack>

                  </Stack>
                </Box>

                <Box sx={{ display: activeTab === 'appearance' ? 'block' : 'none' }}>
                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.68rem', fontWeight: 750, letterSpacing: '0.13em', textTransform: 'uppercase', mb: 1 }}>Рамка аватарки</Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gap: 0.9,
                      gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
                    }}
                  >
                    {ownedShopCosmetics.avatar_frames.map((item) => {
                      const isActive = avatarFrameId === item.selection_id
                      return (
                        <ButtonBase
                          key={item.selection_id}
                          onClick={() => setAvatarFrameId(item.selection_id)}
                          aria-pressed={isActive}
                          sx={{
                            minHeight: 94,
                            borderRadius: '12px',
                            border: isActive ? '1.5px solid var(--morius-accent)' : 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 76%, transparent)',
                            display: 'grid',
                            placeItems: 'center',
                            p: 1,
                            overflow: 'visible',
                          }}
                        >
                          <Stack spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
                            <AvatarFrame frameId={item.selection_id} frameImageUrl={item.image_url} size={46}>
                              <UserAvatar user={previewAvatarUser} size={46} withFrame={false} />
                            </AvatarFrame>
                            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.78rem', fontWeight: 900, lineHeight: 1.1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.title}
                            </Typography>
                          </Stack>
                        </ButtonBase>
                      )
                    })}
                    {AVATAR_FRAME_PRESETS.map((preset) => {
                      const isActive = avatarFrameId === preset.id
                      return (
                        <ButtonBase
                          key={preset.id}
                          onClick={() => setAvatarFrameId(preset.id)}
                          aria-pressed={isActive}
                          sx={{
                            minHeight: 94,
                            borderRadius: '12px',
                            border: isActive ? '1.5px solid var(--morius-accent)' : 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 76%, transparent)',
                            display: 'grid',
                            placeItems: 'center',
                            p: 1,
                            overflow: 'visible',
                          }}
                        >
                          <Stack spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
                            <AvatarFrame frameId={preset.id} size={46}>
                              <UserAvatar user={previewAvatarUser} size={46} withFrame={false} />
                            </AvatarFrame>
                            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.78rem', fontWeight: 900, lineHeight: 1.1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {preset.label}
                            </Typography>
                          </Stack>
                        </ButtonBase>
                      )
                    })}
                  </Box>
                </Box>

                <Box sx={{ display: activeTab === 'appearance' ? 'block' : 'none' }}>
                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.68rem', fontWeight: 750, letterSpacing: '0.13em', textTransform: 'uppercase', mb: 1 }}>Баннер профиля</Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gap: 0.9,
                      gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
                    }}
                  >
                    {ownedShopCosmetics.profile_banners.map((item) => {
                      const isActive = profileBannerId === item.selection_id
                      return (
                        <ButtonBase
                          key={item.selection_id}
                          onClick={() => setProfileBannerId(item.selection_id)}
                          aria-pressed={isActive}
                          sx={{
                            position: 'relative',
                            overflow: 'hidden',
                            minHeight: 94,
                            borderRadius: '12px',
                            border: isActive
                              ? '1.5px solid var(--morius-accent)'
                              : 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 76%, transparent)',
                            boxShadow: isActive ? '0 0 0 2px color-mix(in srgb, var(--morius-accent) 20%, transparent)' : 'none',
                            transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'stretch',
                            gap: 0.65,
                            p: 0.75,
                            '&:hover': {
                              borderColor: 'color-mix(in srgb, var(--morius-accent) 74%, var(--morius-card-border))',
                              transform: 'translateY(-1px)',
                            },
                          }}
                        >
                          <ProgressiveImage
                            src={item.image_url}
                            alt=""
                            objectFit="cover"
                            loaderSize={18}
                            containerSx={{ position: 'relative', width: '100%', height: 58, borderRadius: '9px', overflow: 'hidden' }}
                          />
                          <Box
                            aria-hidden
                            sx={{
                              display: 'none',
                              background: 'linear-gradient(0deg, rgba(3, 5, 8, 0.62) 0%, rgba(3, 5, 8, 0.05) 65%)',
                              zIndex: 1,
                            }}
                          />
                          <Typography
                            component="span"
                            sx={{
                              position: 'static',
                              zIndex: 2,
                              color: 'var(--morius-text-primary)',
                              fontSize: '0.72rem',
                              fontWeight: 650,
                              lineHeight: 1,
                              maxWidth: '100%',
                              textAlign: 'left',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.title}
                          </Typography>
                        </ButtonBase>
                      )
                    })}
                    {PROFILE_BANNER_PRESETS.map((preset) => {
                      const isActive = profileBannerId === preset.id
                      return (
                        <ButtonBase
                          key={preset.id}
                          onClick={() => setProfileBannerId(preset.id)}
                          aria-pressed={isActive}
                          sx={{
                            position: 'relative',
                            overflow: 'hidden',
                            minHeight: 94,
                            borderRadius: '12px',
                            border: isActive
                              ? '1.5px solid var(--morius-accent)'
                              : 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 76%, transparent)',
                            boxShadow: isActive ? '0 0 0 2px color-mix(in srgb, var(--morius-accent) 20%, transparent)' : 'none',
                            transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'stretch',
                            gap: 0.65,
                            p: 0.75,
                            '&:hover': {
                              borderColor: 'color-mix(in srgb, var(--morius-accent) 74%, var(--morius-card-border))',
                              transform: 'translateY(-1px)',
                            },
                          }}
                        >
                          <ProgressiveImage
                            src={preset.src}
                            alt=""
                            objectFit="cover"
                            objectPosition={preset.objectPosition}
                            loaderSize={18}
                            containerSx={{ position: 'relative', width: '100%', height: 58, borderRadius: '9px', overflow: 'hidden' }}
                          />
                          <Box
                            aria-hidden
                            sx={{
                              display: 'none',
                              background: 'linear-gradient(0deg, rgba(3, 5, 8, 0.62) 0%, rgba(3, 5, 8, 0.05) 65%)',
                              zIndex: 1,
                            }}
                          />
                          <Typography
                            component="span"
                            sx={{
                              position: 'static',
                              zIndex: 2,
                              color: 'var(--morius-text-primary)',
                              fontSize: '0.72rem',
                              fontWeight: 650,
                              lineHeight: 1,
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              textAlign: 'left',
                            }}
                          >
                            {preset.label}
                          </Typography>
                        </ButtonBase>
                      )
                    })}
                  </Box>
                </Box>

                <Box sx={{ display: activeTab === 'appearance' ? 'none' : 'grid', gap: 1.4, gridTemplateColumns: '1fr' }}>
                  <Stack spacing={1.3} sx={{ display: activeTab === 'profile' || activeTab === 'privacy' || activeTab === 'notifications' ? 'flex' : 'none' }}>
                    <TextField label="Описание" multiline minRows={4} maxRows={6} value={profileDescription} onChange={(event) => setProfileDescription(event.target.value.slice(0, PROFILE_DESCRIPTION_MAX))} helperText={`${profileDescription.length}/${PROFILE_DESCRIPTION_MAX}`} sx={{ display: activeTab === 'profile' ? 'flex' : 'none', '& .MuiOutlinedInput-root': { alignItems: 'flex-start', borderRadius: '14px', backgroundColor: 'var(--morius-elevated-bg)' } }} />
                    <TextField label="Отображаемое имя" value={displayName} onChange={(event) => setDisplayName(event.target.value.slice(0, DISPLAY_NAME_MAX))} helperText={`${displayName.length}/${DISPLAY_NAME_MAX}`} sx={{ display: activeTab === 'profile' ? 'flex' : 'none', '& .MuiOutlinedInput-root': { borderRadius: '14px', backgroundColor: 'var(--morius-elevated-bg)' } }} />
                    <TextField label="Почта" value={user.email} disabled sx={{ display: activeTab === 'profile' ? 'flex' : 'none', '& .MuiOutlinedInput-root': { borderRadius: '14px', backgroundColor: 'var(--morius-elevated-bg)' } }} />

                    <Box sx={{ display: activeTab === 'privacy' ? 'block' : 'none', borderRadius: '16px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 76%, transparent)', p: 1.5 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800, mb: 1 }}>Приватность</Typography>
                      <Stack spacing={0.9}>
                        {PRIVACY_FIELDS.map((item) => (
                          <SettingsSwitchRow key={item.key} label={item.label} checked={privacy[item.key]} onChange={(checked) => setPrivacy((previous) => ({ ...previous, [item.key]: checked }))} />
                        ))}
                      </Stack>
                    </Box>
                    <Box sx={{ display: activeTab === 'notifications' ? 'block' : 'none', borderRadius: '16px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 76%, transparent)', p: 1.5 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800, mb: 1 }}>AI-помощник</Typography>
                      <SettingsSwitchRow label="Показывать AI-помощника" checked={aiAssistantVisible} onChange={setAiAssistantVisible} />
                    </Box>
                  </Stack>

                  <Stack spacing={1.4} sx={{ display: activeTab === 'profile' || activeTab === 'notifications' ? 'flex' : 'none', alignSelf: 'start' }}>
                    <Box sx={{ display: activeTab === 'notifications' ? 'block' : 'none', borderRadius: '16px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 76%, transparent)', p: 1.5 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800, mb: 1 }}>Уведомления</Typography>
                      <Stack spacing={0.9}>
                        {NOTIFICATION_FIELDS.map((item) => (
                          <SettingsSwitchRow key={item.key} label={item.label} checked={notifications[item.key]} onChange={(checked) => setNotifications((previous) => ({ ...previous, [item.key]: checked }))} />
                        ))}
                      </Stack>
                    </Box>

                    <Box sx={{ display: activeTab === 'profile' ? 'block' : 'none', borderRadius: '16px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 76%, transparent)', p: 1.5 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800 }}>
                        Перепривязать способ входа
                      </Typography>
                      <Typography sx={{ mt: 0.45, color: 'var(--morius-text-secondary)', fontSize: '0.88rem', lineHeight: 1.4 }}>
                        Текущий способ: {AUTH_PROVIDER_LABELS[activeAuthProvider]}. Профиль, игры и покупки останутся на этом аккаунте.
                      </Typography>
                      {authMethodSuccess ? <Alert severity="success" sx={{ mt: 1.1, borderRadius: '12px' }}>{authMethodSuccess}</Alert> : null}
                      <Stack spacing={0.8} sx={{ mt: 1.2 }}>
                        <Button
                          onClick={() => void handleStartYandexLink()}
                          disabled={isAuthMethodBusy || activeAuthProvider === 'yandex'}
                          sx={{
                            minHeight: 44,
                            borderRadius: '12px',
                            textTransform: 'none',
                            color: 'var(--morius-title-text)',
                            border: 'var(--morius-border-width) solid color-mix(in srgb, #fc3f1d 60%, var(--morius-card-border))',
                            backgroundColor: 'color-mix(in srgb, #fc3f1d 10%, var(--morius-card-bg))',
                          }}
                        >
                          {activeAuthProvider === 'yandex'
                            ? 'Подключено: Яндекс'
                            : isStartingYandexLink
                              ? 'Переходим в Яндекс...'
                              : 'Перепривязать к Яндексу'}
                        </Button>
                        <Button
                          onClick={() => {
                            setError('')
                            setAuthMethodSuccess('')
                            setIsPasswordAuthDialogOpen(true)
                          }}
                          disabled={isAuthMethodBusy || activeAuthProvider === 'email'}
                          sx={{
                            minHeight: 44,
                            borderRadius: '12px',
                            textTransform: 'none',
                            color: 'var(--morius-title-text)',
                            border: 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: 'var(--morius-elevated-bg)',
                          }}
                        >
                          {activeAuthProvider === 'email' ? 'Подключено: почта и пароль' : 'Gmail — вход по почте и паролю'}
                        </Button>
                        <Button
                          onClick={() => void handleStartVKIDLink('vk')}
                          disabled={isAuthMethodBusy || activeAuthProvider === 'vk'}
                          sx={{ minHeight: 42, borderRadius: '12px', textTransform: 'none' }}
                        >
                          {activeAuthProvider === 'vk'
                            ? 'Подключено: VK'
                            : vkIDLinkProvider === 'vk'
                              ? 'Переходим в VK ID...'
                              : 'Перепривязать к VK'}
                        </Button>
                        <Button
                          onClick={() => void handleStartVKIDLink('mail')}
                          disabled={isAuthMethodBusy || activeAuthProvider === 'mail'}
                          sx={{ minHeight: 42, borderRadius: '12px', textTransform: 'none' }}
                        >
                          {activeAuthProvider === 'mail'
                            ? 'Подключено: Mail'
                            : vkIDLinkProvider === 'mail'
                              ? 'Переходим в Mail через VK ID...'
                              : 'Перепривязать к Mail'}
                        </Button>
                      </Stack>
                    </Box>
                    <Button
                      onClick={onLogout}
                      sx={{
                        display: activeTab === 'profile' ? 'inline-flex' : 'none',
                        alignSelf: 'flex-start',
                        minHeight: 40,
                        px: 1.7,
                        borderRadius: '11px',
                        textTransform: 'none',
                        color: 'var(--morius-text-secondary)',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        backgroundColor: 'rgba(255,255,255,0.035)',
                      }}
                    >
                      Выйти из аккаунта
                    </Button>

                    <Box
                      sx={{
                        display: activeTab === 'profile' ? 'block' : 'none',
                        mt: 1,
                        borderRadius: '16px',
                        border: '1px solid rgba(221, 110, 110, 0.32)',
                        backgroundColor: 'rgba(160, 50, 50, 0.08)',
                        p: 1.5,
                      }}
                    >
                      <Typography sx={{ color: '#f1b4b4', fontSize: '1.05rem', fontWeight: 800 }}>Удаление аккаунта</Typography>
                      <Typography sx={{ mt: 0.45, color: 'var(--morius-text-secondary)', fontSize: '0.88rem', lineHeight: 1.45 }}>
                        Аккаунт удаляется навсегда вместе со всеми данными: мирами и историями, персонажами, балансом солов,
                        историей покупок и донатов, подпиской и привязанными картами. Восстановить их будет нельзя.
                      </Typography>
                      <Button
                        onClick={() => {
                          setDeleteAccountError('')
                          setIsDeleteAccountOpen(true)
                        }}
                        sx={{
                          mt: 1.2,
                          minHeight: 40,
                          px: 1.7,
                          borderRadius: '11px',
                          textTransform: 'none',
                          fontWeight: 700,
                          color: '#ffd9d9',
                          border: '1px solid rgba(221, 110, 110, 0.45)',
                          backgroundColor: 'rgba(170, 56, 56, 0.2)',
                          '&:hover': { backgroundColor: 'rgba(185, 62, 62, 0.34)', color: '#ffffff' },
                        }}
                      >
                        Удалить аккаунт
                      </Button>
                    </Box>
                  </Stack>
                </Box>
              </Stack>
          </Box>
        </Box>
        </DialogContent>

        <Box
          sx={{
            px: mobileSheet.isMobileSheet ? 1.25 : 2.75,
            pt: mobileSheet.isMobileSheet ? 1 : 1.4,
            pb: mobileSheet.isMobileSheet ? 'calc(8px + env(safe-area-inset-bottom) + 8px)' : 1.4,
            borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
            backgroundColor: 'rgba(0,0,0,0.14)',
            zIndex: 2,
          }}
        >
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
              <Typography sx={{ display: { xs: 'none', sm: 'block' }, color: 'var(--morius-text-secondary)', fontSize: '0.78rem' }}>
                Изменения видны всем сразу после сохранения
              </Typography>
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button onClick={requestDialogClose} sx={{ minHeight: 38, px: 1.8, borderRadius: '11px', textTransform: 'none', color: 'var(--morius-text-primary)', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'rgba(255,255,255,0.05)', '&:hover': { backgroundColor: 'rgba(255,255,255,0.09)' } }}>
                  Отмена
                </Button>
                <Button onClick={() => void handleSaveProfile()} disabled={isSavingProfile} sx={{ minHeight: 38, px: 2.1, borderRadius: '11px', textTransform: 'none', color: '#fff', border: 'none', background: 'var(--morius-accent)', '&:hover': { filter: 'brightness(1.08)' } }}>
                  {isSavingProfile ? 'Сохраняем...' : 'Сохранить'}
                </Button>
              </Stack>
            </Stack>
        </Box>
      </Box>

      <Dialog
        open={isPasswordAuthDialogOpen}
        onClose={() => {
          if (!isReplacingAuthMethod) {
            setIsPasswordAuthDialogOpen(false)
          }
        }}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '18px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            backgroundColor: 'var(--morius-card-bg)',
            color: 'var(--morius-text-primary)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Вход по Gmail и паролю</DialogTitle>
        <DialogContent>
          <Stack spacing={1.2} sx={{ pt: 0.4 }}>
            <Typography sx={{ color: 'var(--morius-text-secondary)', lineHeight: 1.45 }}>
              Для аккаунта {user.email} будет включён вход по почте и паролю. Привязки Google и Яндекса будут заменены.
            </Typography>
            <TextField
              label="Новый пароль"
              type="password"
              autoComplete="new-password"
              value={passwordAuthValue}
              onChange={(event) => setPasswordAuthValue(event.target.value)}
              inputProps={{ maxLength: 128 }}
            />
            <TextField
              label="Повторите пароль"
              type="password"
              autoComplete="new-password"
              value={passwordAuthConfirmValue}
              onChange={(event) => setPasswordAuthConfirmValue(event.target.value)}
              inputProps={{ maxLength: 128 }}
              error={Boolean(passwordAuthConfirmValue && passwordAuthValue !== passwordAuthConfirmValue)}
              helperText={
                passwordAuthConfirmValue && passwordAuthValue !== passwordAuthConfirmValue
                  ? 'Пароли не совпадают'
                  : 'Не менее 8 символов'
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button
            onClick={() => setIsPasswordAuthDialogOpen(false)}
            disabled={isReplacingAuthMethod}
            sx={{ color: 'var(--morius-text-secondary)' }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => void handleReplaceAuthWithPassword()}
            disabled={
              isReplacingAuthMethod
              || passwordAuthValue.length < 8
              || passwordAuthValue !== passwordAuthConfirmValue
            }
            sx={{
              minHeight: 40,
              px: 1.8,
              borderRadius: '12px',
              textTransform: 'none',
              color: 'var(--morius-title-text)',
              backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #ffffff 18%)',
            }}
          >
            {isReplacingAuthMethod ? 'Сохраняем...' : 'Включить вход по паролю'}
          </Button>
        </DialogActions>
      </Dialog>

      <DeleteAccountDialog
        open={isDeleteAccountOpen}
        subject="self"
        targetName={(user.display_name ?? '').trim() || user.email}
        coins={user.coins}
        subscriptionTitle={user.subscription?.plan_title ?? null}
        isSubmitting={isDeletingAccount}
        error={deleteAccountError}
        onClose={() => setIsDeleteAccountOpen(false)}
        onConfirm={(confirmation) => void handleDeleteAccount(confirmation)}
      />

      <Dialog
        open={isCloseConfirmOpen}
        onClose={() => setIsCloseConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '18px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            backgroundColor: 'var(--morius-card-bg)',
            color: 'var(--morius-text-primary)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Закрыть без сохранения?</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'var(--morius-text-secondary)', lineHeight: 1.45 }}>
            Внесенные изменения будут потеряны.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={() => setIsCloseConfirmOpen(false)} sx={{ color: 'var(--morius-text-secondary)' }}>
            Остаться
          </Button>
          <Button
            onClick={closeDialogWithoutPrompt}
            sx={{
              minHeight: 40,
              px: 1.8,
              borderRadius: '12px',
              textTransform: 'none',
              color: 'var(--morius-title-text)',
              border: 'none',
              backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #ffffff 18%)',
            }}
          >
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}

export default SettingsDialog
