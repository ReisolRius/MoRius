import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  MenuItem,
  Popover,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  type DialogProps,
  type SelectChangeEvent,
} from '@mui/material'
import eyedropperIconMarkup from '../../assets/icons/eyedropper.svg?raw'
import editIconMarkup from '../../assets/icons/community-edit.svg?raw'
import {
  createCurrentUserCustomTheme,
  deleteCurrentUserCustomTheme,
  getShopCatalog,
  getCurrentUserThemeSettings,
  replaceCurrentAuthWithPassword,
  startYandexOAuth,
  updateCurrentUserCustomTheme,
  updateCurrentUserProfile,
  updateCurrentUserProfilePrivacy,
  updateCurrentUserThemeSelection,
  CURRENT_USER_CUSTOM_THEME_LIMIT,
  type CosmeticItem,
  type CurrentUserThemeSettings,
  type UserCustomTheme,
} from '../../services/authApi'
import type { AuthUser } from '../../types/auth'
import { getMoriusThemeById, moriusThemePresets, useMoriusThemeController, type MoriusThemePreset } from '../../theme'
import { buildPresetFromCustomTheme } from '../../theme/customTheme'
import { getProfileBannerPreset, normalizeProfileBannerId, PROFILE_BANNER_PRESETS } from '../../constants/profileBanners'
import { resolveProfileBannerImageUrl, withKnownCosmeticImageUrl } from '../../utils/cosmeticImageFallbacks'
import { AVATAR_FRAME_PRESETS, normalizeAvatarFrameId } from '../../constants/avatarFrames'
import useMobileDialogSheet from '../dialogs/useMobileDialogSheet'
import ThemedSvgIcon from '../icons/ThemedSvgIcon'
import ProgressiveImage from '../media/ProgressiveImage'
import AvatarFrame from '../profile/AvatarFrame'
import UserAvatar from '../profile/UserAvatar'

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

type SettingsTabId = 'profile' | 'themes'
type EditableTheme = {
  id: string
  name: string
  description: string
  palette: UserCustomTheme['palette']
  story: UserCustomTheme['story']
}
type PaletteFieldKey = keyof EditableTheme['palette']
type StoryFieldKey = keyof Pick<EditableTheme['story'], 'corrected_text_color' | 'player_text_color' | 'assistant_text_color'>
type ColorFieldKey = PaletteFieldKey | StoryFieldKey

const PROFILE_DESCRIPTION_MAX = 4000
const DISPLAY_NAME_MAX = 120
const THEME_NAME_MAX = 80
const THEME_DESCRIPTION_MAX = 240
const COLOR_SWATCHES = ['#FFFFFF', '#000000', '#4D4D4D', '#D0D0D0', '#D9C4A0', '#B9C9DB'] as const
const trashIconMarkup = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 3.75h6a1.25 1.25 0 0 1 1.25 1.25V6H19a.75.75 0 0 1 0 1.5h-.83l-.64 9.01A2.25 2.25 0 0 1 15.28 18.75H8.72a2.25 2.25 0 0 1-2.25-2.24L5.83 7.5H5a.75.75 0 0 1 0-1.5h2.75V5A1.25 1.25 0 0 1 9 3.75Zm5.75 2.25V5.25h-5.5V6h5.5ZM7.98 7.5l.62 8.9a.75.75 0 0 0 .75.7h6.3a.75.75 0 0 0 .75-.7l.62-8.9H7.98ZM10 9.25a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V10a.75.75 0 0 1 .75-.75Zm4 0a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V10a.75.75 0 0 1 .75-.75Z" fill="currentColor"/></svg>`
const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'profile', label: 'Профиль' },
]
const PALETTE_FIELDS: Array<{ key: PaletteFieldKey; label: string }> = [
  { key: 'title_text', label: 'Заголовок' },
  { key: 'text_primary', label: 'Основной текст' },
  { key: 'background', label: 'Back' },
  { key: 'surface', label: 'Second Back' },
  { key: 'front', label: 'Front' },
  { key: 'input', label: 'Input' },
]
const STORY_FIELDS: Array<{ key: StoryFieldKey; label: string }> = [
  { key: 'corrected_text_color', label: 'Исправленный текст' },
  { key: 'player_text_color', label: 'Текст игрока' },
  { key: 'assistant_text_color', label: 'Текст ИИ' },
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

function createCustomThemeId() {
  return `custom-${Date.now().toString(36)}`
}

function normalizeHexColor(value: string, fallback = '#578EEE'): string {
  const normalized = value.trim().toUpperCase()
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : fallback
}

function isCompleteHexColor(value: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(value.trim())
}

function resolveContrastColor(value: string): string {
  const hex = normalizeHexColor(value)
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111111' : '#F5F7FA'
}

function buildEditableThemeFromPreset(preset: MoriusThemePreset, id = createCustomThemeId()): EditableTheme {
  return {
    id,
    name: 'Новая тема',
    description: 'Пользовательская палитра',
    palette: {
      title_text: preset.colors.titleText,
      text_primary: preset.colors.textPrimary,
      background: preset.colors.appBase,
      surface: preset.colors.appSurface,
      front: preset.colors.accent,
      input: preset.colors.inputBg,
    },
    story: {
      font_family: 'default',
      font_weight: 'regular',
      narrative_italic: false,
      corrected_text_color: preset.story?.correctedTextColor ?? preset.colors.accent,
      player_text_color: preset.story?.playerTextColor ?? preset.colors.textSecondary,
      assistant_text_color: preset.story?.assistantTextColor ?? preset.colors.textPrimary,
    },
  }
}

function buildEditableThemeFromCustom(theme: UserCustomTheme): EditableTheme {
  return { id: theme.id, name: theme.name, description: theme.description, palette: { ...theme.palette }, story: { ...theme.story } }
}

function buildCustomThemeFromDraft(theme: EditableTheme): UserCustomTheme {
  return { id: theme.id.trim() || createCustomThemeId(), name: theme.name.trim() || 'Новая тема', description: theme.description.trim(), palette: { ...theme.palette }, story: { ...theme.story } }
}

function isPaletteField(field: ColorFieldKey): field is PaletteFieldKey {
  return PALETTE_FIELDS.some((item) => item.key === field)
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
  const [activeTab, setActiveTab] = useState<SettingsTabId>('profile')
  const [error, setError] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isSavingTheme, setIsSavingTheme] = useState(false)
  const [themeSettings, setThemeSettings] = useState<CurrentUserThemeSettings | null>(null)
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
  const [themeDraft, setThemeDraft] = useState<EditableTheme>(() => buildEditableThemeFromPreset(getMoriusThemeById('classic-dark')))
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null)
  const [themeDeleteTarget, setThemeDeleteTarget] = useState<UserCustomTheme | null>(null)
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)
  const [isPasswordAuthDialogOpen, setIsPasswordAuthDialogOpen] = useState(false)
  const [passwordAuthValue, setPasswordAuthValue] = useState('')
  const [passwordAuthConfirmValue, setPasswordAuthConfirmValue] = useState('')
  const [isReplacingAuthMethod, setIsReplacingAuthMethod] = useState(false)
  const [isStartingYandexLink, setIsStartingYandexLink] = useState(false)
  const [authMethodSuccess, setAuthMethodSuccess] = useState('')
  const [editingColorField, setEditingColorField] = useState<ColorFieldKey | null>(null)
  const [colorInputDraft, setColorInputDraft] = useState('')
  const [colorPickerAnchorEl, setColorPickerAnchorEl] = useState<HTMLElement | null>(null)
  const colorPickerInputRef = useRef<HTMLInputElement | null>(null)
  const colorSelectionFrameRef = useRef<number | null>(null)
  const pendingColorSelectionRef = useRef<{ field: ColorFieldKey; color: string } | null>(null)
  const { themeId, activeTheme, setTheme, setCustomTheme, setStoryHistoryFontFamily, setStoryHistoryFontWeight, storyHistoryFontFamilyOptions, storyHistoryFontWeightOptions } = useMoriusThemeController()
  const savedCustomThemes = themeSettings?.custom_themes ?? []
  const editingSavedCustomTheme = useMemo(
    () => (editingThemeId ? savedCustomThemes.find((item) => item.id === editingThemeId) ?? null : null),
    [editingThemeId, savedCustomThemes],
  )
  const canCreateMoreCustomThemes = savedCustomThemes.length < CURRENT_USER_CUSTOM_THEME_LIMIT

  const applyResolvedTheme = useCallback((settings: CurrentUserThemeSettings | null) => {
    if (!settings) {
      return
    }
    if (settings.active_theme_kind === 'custom') {
      const selectedCustomTheme = settings.custom_themes.find((item) => item.id === settings.active_theme_id)
      if (selectedCustomTheme) {
        setCustomTheme(buildPresetFromCustomTheme(selectedCustomTheme))
      } else {
        setCustomTheme(null)
        setTheme(getMoriusThemeById('classic-dark').id)
      }
    } else {
      setCustomTheme(null)
      setTheme(getMoriusThemeById(settings.active_theme_id).id)
    }
    setStoryHistoryFontFamily(settings.story.font_family)
    setStoryHistoryFontWeight(settings.story.font_weight)
  }, [setCustomTheme, setStoryHistoryFontFamily, setStoryHistoryFontWeight, setTheme])

  useEffect(() => {
    if (!open) {
      return
    }
    setActiveTab('profile')
    setAuthMethodSuccess('')
    setPasswordAuthValue('')
    setPasswordAuthConfirmValue('')
    setIsPasswordAuthDialogOpen(false)
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
  }, [open, user])

  useEffect(() => {
    if (!open) {
      return
    }
    let ignore = false
    void getCurrentUserThemeSettings({ token: authToken })
      .then((response) => {
        if (ignore) {
          return
        }
        setThemeSettings(response)
        applyResolvedTheme(response)
        if (response.active_theme_kind === 'custom') {
          const selectedTheme = response.custom_themes.find((item) => item.id === response.active_theme_id)
          if (selectedTheme) {
            setEditingThemeId(selectedTheme.id)
            setThemeDraft(buildEditableThemeFromCustom(selectedTheme))
            return
          }
        }
        setEditingThemeId(null)
        setThemeDraft(buildEditableThemeFromPreset(getMoriusThemeById(response.active_theme_id)))
      })
      .catch((requestError) => {
        if (!ignore) {
          const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить настройки темы'
          setError(detail)
        }
      })

    return () => {
      ignore = true
    }
  }, [applyResolvedTheme, authToken, open])

  useEffect(() => {
    if (!open) {
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
  }, [authToken, open])

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

  const hasThemeDraftUnsavedChanges = useMemo(() => {
    if (!editingThemeId) {
      return false
    }
    const normalizedDraft = buildCustomThemeFromDraft(themeDraft)
    const savedTheme = savedCustomThemes.find((item) => item.id === normalizedDraft.id)
    if (!savedTheme) {
      return true
    }
    return JSON.stringify(normalizedDraft) !== JSON.stringify(savedTheme)
  }, [editingThemeId, savedCustomThemes, themeDraft])

  const hasUnsavedChanges = hasProfileUnsavedChanges || hasThemeDraftUnsavedChanges

  const closeDialogWithoutPrompt = () => {
    applyResolvedTheme(themeSettings)
    handleCloseColorPicker()
    setThemeDeleteTarget(null)
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

  const handleSelectPresetTheme = async (presetId: string) => {
    if (isSavingTheme) {
      return
    }
    setError('')
    setIsSavingTheme(true)
    try {
      const response = await updateCurrentUserThemeSelection({
        token: authToken,
        active_theme_kind: 'preset',
        active_theme_id: presetId,
      })
      setThemeSettings(response)
      setEditingThemeId(null)
      setThemeDraft(buildEditableThemeFromPreset(getMoriusThemeById(response.active_theme_id)))
      applyResolvedTheme(response)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось применить тему'
      setError(detail)
    } finally {
      setIsSavingTheme(false)
    }
  }

  const handleEditCustomTheme = (theme: UserCustomTheme) => {
    setActiveTab('themes')
    setEditingThemeId(theme.id)
    setThemeDraft(buildEditableThemeFromCustom(theme))
    setError('')
  }

  const handleStartNewTheme = () => {
    if (!canCreateMoreCustomThemes) {
      setError(`Можно создать не более ${CURRENT_USER_CUSTOM_THEME_LIMIT} пользовательских тем.`)
      return
    }
    const nextId = createCustomThemeId()
    setActiveTab('themes')
    setEditingThemeId(nextId)
    setThemeDraft(buildEditableThemeFromPreset(activeTheme, nextId))
    setError('')
  }

  const handleSelectColor = (field: ColorFieldKey, nextColor: string) => {
    const normalized = normalizeHexColor(nextColor)
    setThemeDraft((previous) => {
      if (isPaletteField(field)) {
        return { ...previous, palette: { ...previous.palette, [field]: normalized } }
      }
      return { ...previous, story: { ...previous.story, [field]: normalized } }
    })
  }

  const syncColorPickerInputValue = useCallback((nextValue: string) => {
    if (!colorPickerInputRef.current) {
      return
    }
    if (colorPickerInputRef.current.value.toLowerCase() === nextValue.toLowerCase()) {
      return
    }
    colorPickerInputRef.current.value = nextValue
  }, [])

  const scheduleColorSelection = useCallback((field: ColorFieldKey, nextColor: string) => {
    const normalized = normalizeHexColor(nextColor)
    pendingColorSelectionRef.current = { field, color: normalized }
    if (typeof window === 'undefined') {
      pendingColorSelectionRef.current = null
      startTransition(() => {
        handleSelectColor(field, normalized)
      })
      return
    }
    if (colorSelectionFrameRef.current !== null) {
      return
    }
    colorSelectionFrameRef.current = window.requestAnimationFrame(() => {
      colorSelectionFrameRef.current = null
      const pendingSelection = pendingColorSelectionRef.current
      pendingColorSelectionRef.current = null
      if (!pendingSelection) {
        return
      }
      startTransition(() => {
        handleSelectColor(pendingSelection.field, pendingSelection.color)
      })
    })
  }, [handleSelectColor])

  const handleOpenColorPicker = (event: ReactMouseEvent<HTMLElement>, field: ColorFieldKey) => {
    const currentColor = isPaletteField(field) ? themeDraft.palette[field] : themeDraft.story[field]
    setEditingColorField(field)
    setColorInputDraft(currentColor)
    setColorPickerAnchorEl(event.currentTarget)
  }

  const handleCloseColorPicker = () => {
    setEditingColorField(null)
    setColorInputDraft('')
    setColorPickerAnchorEl(null)
  }

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined' || colorSelectionFrameRef.current === null) {
        return
      }
      window.cancelAnimationFrame(colorSelectionFrameRef.current)
    }
  }, [])

  const handleStartYandexLink = async () => {
    if (isStartingYandexLink || isReplacingAuthMethod) {
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

  const handleReplaceAuthWithPassword = async () => {
    if (isReplacingAuthMethod) {
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

  const handleSaveTheme = async () => {
    if (isSavingTheme) {
      return
    }
    setError('')
    const themeExists = savedCustomThemes.some((item) => item.id === themeDraft.id)
    if (!themeExists && savedCustomThemes.length >= CURRENT_USER_CUSTOM_THEME_LIMIT) {
      setError(`Можно создать не более ${CURRENT_USER_CUSTOM_THEME_LIMIT} пользовательских тем.`)
      return
    }
    setIsSavingTheme(true)
    try {
      const payload = buildCustomThemeFromDraft(themeDraft)
      const response = themeExists
        ? await updateCurrentUserCustomTheme({ token: authToken, theme: payload })
        : await createCurrentUserCustomTheme({ token: authToken, theme: payload })
      setThemeSettings(response)
      setEditingThemeId(payload.id)
      setThemeDraft(buildEditableThemeFromCustom(response.custom_themes.find((item) => item.id === payload.id) ?? payload))
      applyResolvedTheme(response)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось сохранить тему'
      setError(detail)
    } finally {
      setIsSavingTheme(false)
    }
  }

  const handleSelectCustomTheme = async (theme: UserCustomTheme) => {
    if (isSavingTheme) {
      return
    }
    setError('')
    setIsSavingTheme(true)
    try {
      const response = await updateCurrentUserThemeSelection({
        token: authToken,
        active_theme_kind: 'custom',
        active_theme_id: theme.id,
      })
      const selectedTheme = response.custom_themes.find((item) => item.id === theme.id) ?? theme
      setThemeSettings(response)
      setEditingThemeId(selectedTheme.id)
      setThemeDraft(buildEditableThemeFromCustom(selectedTheme))
      applyResolvedTheme(response)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось применить тему'
      setError(detail)
    } finally {
      setIsSavingTheme(false)
    }
  }

  const handleRequestDeleteTheme = (theme: UserCustomTheme) => {
    setThemeDeleteTarget(theme)
    setError('')
  }

  const handleDeleteTheme = async (themeId: string) => {
    if (isSavingTheme || !savedCustomThemes.some((item) => item.id === themeId)) {
      return
    }
    setError('')
    setIsSavingTheme(true)
    try {
      const response = await deleteCurrentUserCustomTheme({ token: authToken, theme_id: themeId })
      const deletedEditingTheme = editingThemeId === themeId
      setThemeSettings(response)
      setThemeDeleteTarget(null)
      if (deletedEditingTheme) {
        if (response.active_theme_kind === 'custom') {
          const selectedTheme = response.custom_themes.find((item) => item.id === response.active_theme_id)
          if (selectedTheme) {
            setEditingThemeId(selectedTheme.id)
            setThemeDraft(buildEditableThemeFromCustom(selectedTheme))
          } else {
            setEditingThemeId(null)
            setThemeDraft(buildEditableThemeFromPreset(getMoriusThemeById(response.active_theme_id)))
          }
        } else {
          setEditingThemeId(null)
          setThemeDraft(buildEditableThemeFromPreset(getMoriusThemeById(response.active_theme_id)))
        }
      }
      applyResolvedTheme(response)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось удалить тему'
      setError(detail)
    } finally {
      setIsSavingTheme(false)
    }
  }

  const handleResetDraft = () => {
    if (editingSavedCustomTheme) {
      setEditingThemeId(editingSavedCustomTheme.id)
      setThemeDraft(buildEditableThemeFromCustom(editingSavedCustomTheme))
      return
    }
    setEditingThemeId(null)
    setThemeDraft(buildEditableThemeFromPreset(getMoriusThemeById(themeSettings?.active_theme_id ?? themeId)))
    applyResolvedTheme(themeSettings)
  }

  const activeFieldColor = editingColorField ? (isPaletteField(editingColorField) ? themeDraft.palette[editingColorField] : themeDraft.story[editingColorField]) : '#578EEE'
  const activeColorInputValue = colorInputDraft || activeFieldColor
  const pickerColorValue = normalizeHexColor(activeColorInputValue, activeFieldColor).toLowerCase()
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

  useEffect(() => {
    syncColorPickerInputValue(pickerColorValue)
  }, [pickerColorValue, syncColorPickerInputValue])

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      fullWidth
      maxWidth={false}
      sx={mobileSheet.dialogSx}
      BackdropProps={{
        sx: {
          ...mobileSheet.backdropSx,
          backgroundColor: 'rgba(6, 10, 14, 0.9)',
        },
      }}
      PaperProps={{
        ...mobileSheet.paperTouchHandlers,
        sx: {
          width: 'min(1600px, calc(100vw - 24px))',
          maxWidth: 'none',
          height: 'min(920px, calc(100vh - 24px))',
          borderRadius: '22px',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 38%, #020304 62%)',
          color: 'var(--morius-text-primary)',
          overflow: 'hidden',
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
          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 38%, #020304 62%)',
        }}
      >
        <Box
          sx={{
            px: mobileSheet.isMobileSheet ? 1.3 : 2.2,
            py: mobileSheet.isMobileSheet ? 1.1 : 1.45,
            borderBottom: 'var(--morius-border-width) solid var(--morius-card-border)',
            backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 72%, #020304 28%)',
            boxShadow: '0 10px 24px rgba(0, 0, 0, 0.18)',
            zIndex: 2,
          }}
        >
          <Stack direction="row" spacing={1.2} alignItems="center" justifyContent="space-between">
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                sx={{
                  color: 'var(--morius-title-text)',
                  fontSize: mobileSheet.isMobileSheet ? '1.45rem' : '1.8rem',
                  fontWeight: 900,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                Настройки
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
                borderRadius: 0,
                color: 'color-mix(in srgb, var(--morius-title-text) 76%, black 24%)',
                backgroundColor: 'transparent',
                fontSize: '1.8rem',
                fontWeight: 700,
                lineHeight: 1,
                flexShrink: 0,
                '&:hover': {
                  backgroundColor: 'transparent',
                  color: 'var(--morius-title-text)',
                },
              }}
            >
              ×
            </Button>
          </Stack>
        </Box>

        <DialogContent sx={{ p: 0, minHeight: 0, overflow: 'hidden', backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 38%, #020304 62%)' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            height: '100%',
            minHeight: 0,
          }}
        >
          <Box
            sx={{
              display: 'none',
              borderRight: { xs: 'none', md: 'var(--morius-border-width) solid var(--morius-card-border)' },
              borderBottom: mobileSheet.isMobileSheet
                ? 'var(--morius-border-width) solid var(--morius-card-border)'
                : { xs: 'var(--morius-border-width) solid var(--morius-card-border)', md: 'none' },
              backgroundColor: 'var(--morius-card-bg)',
              position: mobileSheet.isMobileSheet ? 'static' : { md: 'sticky' },
              top: 0,
              alignSelf: mobileSheet.isMobileSheet ? 'stretch' : 'start',
              height: mobileSheet.isMobileSheet ? 'auto' : { md: 'min(920px, calc(100vh - 24px))' },
            }}
          >
            <Stack spacing={1.2} sx={{ p: mobileSheet.isMobileSheet ? 1.4 : 2.2 }}>
              <Typography
                sx={{
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
                        minHeight: mobileSheet.isMobileSheet ? 48 : 56,
                        minWidth: mobileSheet.isMobileSheet ? 'fit-content' : '100%',
                        justifyContent: 'flex-start',
                        px: 1.8,
                        borderRadius: '16px',
                        textTransform: 'none',
                        fontSize: '1rem',
                        fontWeight: isActive ? 800 : 700,
                        color: isActive ? 'var(--morius-accent)' : 'var(--morius-text-primary)',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        backgroundColor: isActive ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))' : 'transparent',
                        '&:hover': {
                          backgroundColor: isActive ? 'color-mix(in srgb, var(--morius-accent) 14%, var(--morius-card-bg))' : 'color-mix(in srgb, var(--morius-button-hover) 45%, transparent)',
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
              p: mobileSheet.isMobileSheet ? 1.2 : { xs: 1.35, md: 2.2 },
              backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 34%, #020304 66%)',
            }}
          >
            {error ? <Alert severity="error" onClose={() => setError('')} sx={{ mb: 1.4, borderRadius: '14px' }}>{error}</Alert> : null}
            {avatarError ? <Alert severity="error" sx={{ mb: 1.4, borderRadius: '14px' }}>{avatarError}</Alert> : null}

            {activeTab === 'profile' ? (
              <Stack spacing={1.6}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <Typography sx={{ color: 'var(--morius-accent)', fontSize: { xs: '2.25rem', md: '2.7rem' }, fontWeight: 900, lineHeight: 1 }}>Профиль</Typography>
                  <Button
                    onClick={requestDialogClose}
                    disableRipple
                    sx={{
                      display: 'none',
                      minWidth: 44,
                      width: 44,
                      height: 44,
                      p: 0,
                      borderRadius: 0,
                      color: 'color-mix(in srgb, var(--morius-title-text) 72%, black 28%)',
                      backgroundColor: 'transparent',
                      fontSize: '1.85rem',
                      fontWeight: 700,
                      lineHeight: 1,
                      '&:hover': {
                        backgroundColor: 'transparent',
                        color: 'var(--morius-title-text)',
                      },
                    }}
                  >
                    ×
                  </Button>
                </Stack>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.96rem', fontWeight: 700 }}>Предпросмотр</Typography>

                <Box
                  sx={{
                    position: 'relative',
                    overflow: 'hidden',
                    minHeight: { xs: 228, sm: 196 },
                    borderRadius: '20px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-card-bg)',
                    p: { xs: 1.6, md: 2 },
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
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      backgroundColor: 'var(--morius-card-bg)',
                    }}
                  />
                  <Box
                    aria-hidden
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      zIndex: 1,
                      background:
                        'linear-gradient(90deg, rgba(5, 8, 12, 0.72) 0%, rgba(5, 8, 12, 0.38) 58%, rgba(5, 8, 12, 0.68) 100%), linear-gradient(0deg, rgba(5, 8, 12, 0.62) 0%, rgba(5, 8, 12, 0.16) 100%)',
                    }}
                  />
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.2}
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    sx={{ position: 'relative', zIndex: 2, minHeight: { xs: 176, sm: 144 } }}
                  >
                    <Box
                      sx={{
                        position: 'relative',
                        width: { xs: 76, sm: 88 },
                        height: { xs: 76, sm: 88 },
                        flexShrink: 0,
                        borderRadius: '50%',
                        boxShadow: '0 0 0 4px var(--morius-app-base), 0 16px 32px rgba(0, 0, 0, 0.3)',
                      }}
                    >
                      {onChooseAvatar ? (
                        <Button
                          onClick={onChooseAvatar}
                          disabled={isAvatarSaving}
                          disableRipple
                          sx={{
                            minWidth: 0,
                            width: { xs: 76, sm: 88 },
                            height: { xs: 76, sm: 88 },
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
                          <AvatarFrame frameId={avatarFrameId} frameImageUrl={selectedOwnedAvatarFrame?.image_url ?? null} size={mobileSheet.isMobileSheet ? 76 : 88}>
                            <UserAvatar user={previewAvatarUser} size={mobileSheet.isMobileSheet ? 76 : 88} withFrame={false} />
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
                        <AvatarFrame frameId={avatarFrameId} frameImageUrl={selectedOwnedAvatarFrame?.image_url ?? null} size={mobileSheet.isMobileSheet ? 76 : 88}>
                          <UserAvatar user={previewAvatarUser} size={mobileSheet.isMobileSheet ? 76 : 88} withFrame={false} />
                        </AvatarFrame>
                      )}
                      {avatarInputRef && onAvatarChange ? <Box component="input" ref={avatarInputRef} type="file" accept="image/*" onChange={onAvatarChange} sx={{ display: 'none' }} /> : null}
                    </Box>

                    <Stack spacing={0.22} sx={{ minWidth: 0, flex: 1 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: { xs: '2rem', md: '2.5rem' }, fontWeight: 900, lineHeight: 1 }}>{displayName.trim() || 'Игрок'}</Typography>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '1rem', lineHeight: 1.2 }}>{user.email}</Typography>
                      <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '1rem', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {previewDescription}
                      </Typography>
                    </Stack>

                  </Stack>
                </Box>

                <Box sx={{ borderRadius: '18px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-card-bg)', p: { xs: 1.1, md: 1.35 } }}>
                  <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800, mb: 1 }}>Рамка аватарки</Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gap: 0.85,
                      gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', xl: 'repeat(6, minmax(0, 1fr))' },
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
                            minHeight: 118,
                            borderRadius: '14px',
                            border: isActive ? '2px solid var(--morius-accent)' : 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: 'var(--morius-elevated-bg)',
                            display: 'grid',
                            placeItems: 'center',
                            p: 1,
                            overflow: 'visible',
                          }}
                        >
                          <Stack spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
                            <AvatarFrame frameId={item.selection_id} frameImageUrl={item.image_url} size={58}>
                              <UserAvatar user={previewAvatarUser} size={58} withFrame={false} />
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
                            minHeight: 118,
                            borderRadius: '14px',
                            border: isActive ? '2px solid var(--morius-accent)' : 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: 'var(--morius-elevated-bg)',
                            display: 'grid',
                            placeItems: 'center',
                            p: 1,
                            overflow: 'visible',
                          }}
                        >
                          <Stack spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
                            <AvatarFrame frameId={preset.id} size={58}>
                              <UserAvatar user={previewAvatarUser} size={58} withFrame={false} />
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

                <Box sx={{ borderRadius: '18px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-card-bg)', p: { xs: 1.1, md: 1.35 } }}>
                  <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800, mb: 1 }}>Фон профиля</Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gap: 0.85,
                      gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', xl: 'repeat(5, minmax(0, 1fr))' },
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
                            aspectRatio: '16 / 9',
                            borderRadius: '12px',
                            border: isActive
                              ? '2px solid var(--morius-accent)'
                              : 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                            backgroundColor: 'var(--morius-elevated-bg)',
                            boxShadow: isActive ? '0 0 0 2px color-mix(in srgb, var(--morius-accent) 20%, transparent)' : 'none',
                            transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
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
                            containerSx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                          />
                          <Box
                            aria-hidden
                            sx={{
                              position: 'absolute',
                              inset: 0,
                              background: 'linear-gradient(0deg, rgba(3, 5, 8, 0.62) 0%, rgba(3, 5, 8, 0.05) 65%)',
                              zIndex: 1,
                            }}
                          />
                          <Typography
                            component="span"
                            sx={{
                              position: 'absolute',
                              left: 10,
                              bottom: 8,
                              zIndex: 2,
                              color: '#fff',
                              fontSize: '0.78rem',
                              fontWeight: 900,
                              lineHeight: 1,
                              maxWidth: 'calc(100% - 20px)',
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
                            aspectRatio: '16 / 9',
                            borderRadius: '12px',
                            border: isActive
                              ? '2px solid var(--morius-accent)'
                              : 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                            backgroundColor: 'var(--morius-elevated-bg)',
                            boxShadow: isActive ? '0 0 0 2px color-mix(in srgb, var(--morius-accent) 20%, transparent)' : 'none',
                            transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
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
                            containerSx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                          />
                          <Box
                            aria-hidden
                            sx={{
                              position: 'absolute',
                              inset: 0,
                              background: 'linear-gradient(0deg, rgba(3, 5, 8, 0.62) 0%, rgba(3, 5, 8, 0.05) 65%)',
                              zIndex: 1,
                            }}
                          />
                          <Typography
                            component="span"
                            sx={{
                              position: 'absolute',
                              left: 10,
                              bottom: 8,
                              zIndex: 2,
                              color: '#fff',
                              fontSize: '0.78rem',
                              fontWeight: 900,
                              lineHeight: 1,
                            }}
                          >
                            {preset.label}
                          </Typography>
                        </ButtonBase>
                      )
                    })}
                  </Box>
                </Box>

                <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 0.92fr) minmax(320px, 0.72fr)' } }}>
                  <Stack spacing={1.3}>
                    <TextField label="Описание" multiline minRows={4} maxRows={6} value={profileDescription} onChange={(event) => setProfileDescription(event.target.value.slice(0, PROFILE_DESCRIPTION_MAX))} helperText={`${profileDescription.length}/${PROFILE_DESCRIPTION_MAX}`} sx={{ '& .MuiOutlinedInput-root': { alignItems: 'flex-start', borderRadius: '16px', backgroundColor: 'var(--morius-elevated-bg)' } }} />
                    <TextField label="Отображаемое имя" value={displayName} onChange={(event) => setDisplayName(event.target.value.slice(0, DISPLAY_NAME_MAX))} helperText={`${displayName.length}/${DISPLAY_NAME_MAX}`} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '14px', backgroundColor: 'var(--morius-elevated-bg)' } }} />
                    <TextField label="Почта" value={user.email} disabled sx={{ '& .MuiOutlinedInput-root': { borderRadius: '14px', backgroundColor: 'var(--morius-elevated-bg)' } }} />

                    <Box sx={{ borderRadius: '18px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-card-bg)', p: 1.35 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800, mb: 1 }}>Приватность</Typography>
                      <Stack spacing={0.9}>
                        {PRIVACY_FIELDS.map((item) => (
                          <SettingsSwitchRow key={item.key} label={item.label} checked={privacy[item.key]} onChange={(checked) => setPrivacy((previous) => ({ ...previous, [item.key]: checked }))} />
                        ))}
                      </Stack>
                    </Box>
                    <Box sx={{ borderRadius: '18px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-card-bg)', p: 1.35 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800, mb: 1 }}>AI-помощник</Typography>
                      <SettingsSwitchRow label="Показывать AI-помощника" checked={aiAssistantVisible} onChange={setAiAssistantVisible} />
                    </Box>
                  </Stack>

                  <Stack spacing={1.4} sx={{ alignSelf: 'start' }}>
                    <Box sx={{ borderRadius: '18px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-card-bg)', p: 1.35 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800, mb: 1 }}>Уведомления</Typography>
                      <Stack spacing={0.9}>
                        {NOTIFICATION_FIELDS.map((item) => (
                          <SettingsSwitchRow key={item.key} label={item.label} checked={notifications[item.key]} onChange={(checked) => setNotifications((previous) => ({ ...previous, [item.key]: checked }))} />
                        ))}
                      </Stack>
                    </Box>

                    <Box sx={{ borderRadius: '18px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-card-bg)', p: 1.35 }}>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800 }}>
                        Перепривязать способ входа
                      </Typography>
                      <Typography sx={{ mt: 0.45, color: 'var(--morius-text-secondary)', fontSize: '0.88rem', lineHeight: 1.4 }}>
                        Текущий способ: {user.auth_provider || 'email'}. Профиль, игры и покупки останутся на этом аккаунте.
                      </Typography>
                      {authMethodSuccess ? <Alert severity="success" sx={{ mt: 1.1, borderRadius: '12px' }}>{authMethodSuccess}</Alert> : null}
                      <Stack spacing={0.8} sx={{ mt: 1.2 }}>
                        <Button
                          onClick={() => void handleStartYandexLink()}
                          disabled={isStartingYandexLink || isReplacingAuthMethod}
                          sx={{
                            minHeight: 44,
                            borderRadius: '12px',
                            textTransform: 'none',
                            color: 'var(--morius-title-text)',
                            border: 'var(--morius-border-width) solid color-mix(in srgb, #fc3f1d 60%, var(--morius-card-border))',
                            backgroundColor: 'color-mix(in srgb, #fc3f1d 10%, var(--morius-card-bg))',
                          }}
                        >
                          {isStartingYandexLink ? 'Переходим в Яндекс...' : 'Перепривязать к Яндексу'}
                        </Button>
                        <Button
                          onClick={() => {
                            setError('')
                            setAuthMethodSuccess('')
                            setIsPasswordAuthDialogOpen(true)
                          }}
                          disabled={isStartingYandexLink || isReplacingAuthMethod}
                          sx={{
                            minHeight: 44,
                            borderRadius: '12px',
                            textTransform: 'none',
                            color: 'var(--morius-title-text)',
                            border: 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: 'var(--morius-elevated-bg)',
                          }}
                        >
                          Gmail — вход по почте и паролю
                        </Button>
                        <Button disabled sx={{ minHeight: 42, borderRadius: '12px', textTransform: 'none' }}>
                          Перепривязать к VK — скоро
                        </Button>
                        <Button disabled sx={{ minHeight: 42, borderRadius: '12px', textTransform: 'none' }}>
                          Перепривязать к Mail — скоро
                        </Button>
                      </Stack>
                    </Box>
                  </Stack>
                </Box>
              </Stack>
            ) : (
              <Stack spacing={1.6}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={1}>
                  <Typography sx={{ color: 'var(--morius-accent)', fontSize: { xs: '2.2rem', md: '2.7rem' }, fontWeight: 900, lineHeight: 1 }}>Темы</Typography>
                  <Button
                    onClick={requestDialogClose}
                    disableRipple
                    sx={{
                      display: 'none',
                      minWidth: 44,
                      width: 44,
                      height: 44,
                      p: 0,
                      borderRadius: 0,
                      color: 'color-mix(in srgb, var(--morius-title-text) 72%, black 28%)',
                      backgroundColor: 'transparent',
                      fontSize: '1.85rem',
                      fontWeight: 700,
                      lineHeight: 1,
                      '&:hover': {
                        backgroundColor: 'transparent',
                        color: 'var(--morius-title-text)',
                      },
                    }}
                  >
                    ×
                  </Button>
                </Stack>

                <Stack spacing={0.9}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    spacing={0.4}
                  >
                    <Box>
                      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 800 }}>Все темы</Typography>
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem' }}>
                        Нажмите на тему, чтобы применить ее. Сохранение создаст или обновит вашу тему в аккаунте.
                      </Typography>
                    </Box>
                    <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem', fontWeight: 700 }}>
                      Свои темы: {savedCustomThemes.length}/{CURRENT_USER_CUSTOM_THEME_LIMIT}
                    </Typography>
                  </Stack>
                  <Box sx={{ display: 'grid', gap: 0.8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    {moriusThemePresets.map((preset) => {
                      const isActive = themeSettings?.active_theme_kind === 'preset' && themeSettings.active_theme_id === preset.id
                      return (
                        <Button
                          key={preset.id}
                          onClick={() => void handleSelectPresetTheme(preset.id)}
                          disabled={isSavingTheme}
                          sx={{
                            minHeight: 96,
                            p: 1.2,
                            alignItems: 'stretch',
                            justifyContent: 'flex-start',
                            borderRadius: '20px',
                            textTransform: 'none',
                            border: 'none',
                            backgroundColor: isActive
                              ? 'color-mix(in srgb, var(--morius-accent) 12%, var(--morius-card-bg))'
                              : 'color-mix(in srgb, var(--morius-card-bg) 72%, var(--morius-elevated-bg) 28%)',
                            boxShadow: isActive
                              ? '0 0 24px color-mix(in srgb, var(--morius-accent) 18%, transparent), 0 18px 36px rgba(0, 0, 0, 0.22)'
                              : '0 14px 30px rgba(0, 0, 0, 0.18)',
                            '&:hover': {
                              backgroundColor: isActive
                                ? 'color-mix(in srgb, var(--morius-accent) 14%, var(--morius-card-bg))'
                                : 'color-mix(in srgb, var(--morius-card-bg) 66%, var(--morius-elevated-bg) 34%)',
                              boxShadow: isActive
                                ? '0 0 28px color-mix(in srgb, var(--morius-accent) 22%, transparent), 0 20px 38px rgba(0, 0, 0, 0.24)'
                                : '0 16px 32px rgba(0, 0, 0, 0.2)',
                            },
                          }}
                        >
                          <Stack spacing={0.7} sx={{ width: '100%', textAlign: 'left' }}>
                            <Stack direction="row" spacing={0.45}>
                              {[preset.colors.titleText, preset.colors.textPrimary, preset.colors.appBase, preset.colors.appSurface, preset.colors.accent].map((color, index) => (
                                <Box key={`${preset.id}-${index}`} sx={{ width: 18, height: 18, borderRadius: '50%', backgroundColor: color, border: 'var(--morius-border-width) solid rgba(255,255,255,0.16)' }} />
                              ))}
                            </Stack>
                            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 800 }}>{preset.name}</Typography>
                            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.83rem', lineHeight: 1.35 }}>{preset.description}</Typography>
                          </Stack>
                        </Button>
                      )
                    })}
                    {savedCustomThemes.map((theme) => {
                      const isActive = themeSettings?.active_theme_kind === 'custom' && themeSettings.active_theme_id === theme.id
                      return (
                        <Box
                          key={theme.id}
                          className="morius-theme-card"
                          sx={{
                            position: 'relative',
                            p: 1.15,
                            borderRadius: '20px',
                            border: 'none',
                            backgroundColor: isActive
                              ? 'color-mix(in srgb, var(--morius-accent) 11%, var(--morius-card-bg))'
                              : 'color-mix(in srgb, var(--morius-card-bg) 72%, var(--morius-elevated-bg) 28%)',
                            boxShadow: isActive
                              ? '0 0 24px color-mix(in srgb, var(--morius-accent) 18%, transparent), 0 18px 36px rgba(0, 0, 0, 0.22)'
                              : '0 14px 30px rgba(0, 0, 0, 0.18)',
                          }}
                        >
                          <IconButton
                            aria-label={`Удалить тему ${theme.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              handleRequestDeleteTheme(theme)
                            }}
                            sx={{
                              position: 'absolute',
                              top: 8,
                              right: 8,
                              width: 30,
                              height: 30,
                              borderRadius: '10px',
                              color: 'var(--morius-title-text)',
                              backgroundColor: 'color-mix(in srgb, rgba(8, 10, 14, 0.88) 78%, var(--morius-card-bg) 22%)',
                              opacity: { xs: 1, md: 0 },
                              transition: 'opacity 160ms ease, transform 160ms ease',
                              transform: { xs: 'none', md: 'translateY(-2px)' },
                              '.morius-theme-card:hover &, .morius-theme-card:focus-within &': {
                                opacity: 1,
                                transform: 'translateY(0)',
                              },
                              '&:hover': {
                                backgroundColor: 'color-mix(in srgb, var(--morius-accent) 18%, rgba(8, 10, 14, 0.88))',
                              },
                            }}
                          >
                            <ThemedSvgIcon markup={trashIconMarkup} size={15} />
                          </IconButton>
                          <Stack spacing={0.7} sx={{ height: '100%' }}>
                            <Stack direction="row" spacing={0.45}>
                              {[theme.palette.title_text, theme.palette.text_primary, theme.palette.background, theme.palette.surface, theme.palette.front].map((color, index) => (
                                <Box key={`${theme.id}-custom-${index}`} sx={{ width: 18, height: 18, borderRadius: '50%', backgroundColor: color, border: 'var(--morius-border-width) solid rgba(255,255,255,0.16)' }} />
                              ))}
                            </Stack>
                            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 800 }}>{theme.name}</Typography>
                            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.83rem', lineHeight: 1.35, flex: 1 }}>{theme.description || 'Пользовательская палитра'}</Typography>
                            <Stack direction="row" spacing={0.7}>
                              <Button
                                onClick={() => void handleSelectCustomTheme(theme)}
                                disabled={isSavingTheme}
                                sx={{ flex: 1, minHeight: 36, borderRadius: '12px', textTransform: 'none', color: 'var(--morius-text-primary)', border: 'none', backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 78%, var(--morius-card-bg) 22%)' }}
                              >
                                Применить
                              </Button>
                              <Button onClick={() => handleEditCustomTheme(theme)} sx={{ flex: 1, minHeight: 36, borderRadius: '12px', textTransform: 'none', color: 'var(--morius-text-primary)', border: 'none', backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 78%, var(--morius-card-bg) 22%)' }}>
                                Изменить
                              </Button>
                            </Stack>
                          </Stack>
                        </Box>
                      )
                    })}
                    <Button
                      onClick={handleStartNewTheme}
                      disabled={isSavingTheme || !canCreateMoreCustomThemes}
                      sx={{
                        minHeight: 96,
                        p: 1.2,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '20px',
                        textTransform: 'none',
                        border: 'none',
                        backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 72%, var(--morius-elevated-bg) 28%)',
                        boxShadow: '0 14px 30px rgba(0, 0, 0, 0.18)',
                        '&:hover': {
                          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 66%, var(--morius-elevated-bg) 34%)',
                          boxShadow: '0 16px 32px rgba(0, 0, 0, 0.2)',
                        },
                        '&.Mui-disabled': {
                          color: 'var(--morius-text-secondary)',
                          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 82%, var(--morius-elevated-bg) 18%)',
                          boxShadow: 'none',
                        },
                      }}
                    >
                      <Stack spacing={0.55} alignItems="center">
                        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '2rem', fontWeight: 400, lineHeight: 1 }}>+</Typography>
                        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.96rem', fontWeight: 800 }}>Новая тема</Typography>
                        {!canCreateMoreCustomThemes ? (
                          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem' }}>Лимит достигнут</Typography>
                        ) : null}
                      </Stack>
                    </Button>
                  </Box>
                </Stack>

                <Box sx={{ borderRadius: '22px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-card-bg)', p: { xs: 1.1, md: 1.45 } }}>
                  <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 0.8fr) minmax(440px, 0.96fr)' } }}>
                    <Stack spacing={1.15}>
                      <TextField label="Название темы" value={themeDraft.name} onChange={(event) => setThemeDraft((previous) => ({ ...previous, name: event.target.value.slice(0, THEME_NAME_MAX) }))} helperText={`${themeDraft.name.length}/${THEME_NAME_MAX}`} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '14px', backgroundColor: 'var(--morius-elevated-bg)' } }} />
                      <TextField label="Описание" value={themeDraft.description} onChange={(event) => setThemeDraft((previous) => ({ ...previous, description: event.target.value.slice(0, THEME_DESCRIPTION_MAX) }))} helperText={`${themeDraft.description.length}/${THEME_DESCRIPTION_MAX}`} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '14px', backgroundColor: 'var(--morius-elevated-bg)' } }} />
                      <Box sx={{ borderRadius: '18px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: themeDraft.palette.surface, color: themeDraft.palette.text_primary, p: 1.35 }}>
                        <Typography sx={{ color: themeDraft.palette.title_text, fontSize: { xs: '2rem', md: '2.3rem' }, fontWeight: 900 }}>{themeDraft.name.trim() || 'Новая тема'}</Typography>
                        <Typography sx={{ mt: 0.45, color: themeDraft.story.corrected_text_color, fontSize: '0.95rem', lineHeight: 1.4 }}>Исправленный текст</Typography>
                        <Typography sx={{ mt: 0.8, color: themeDraft.story.player_text_color, fontSize: '0.95rem', lineHeight: 1.45 }}>Текст написанный игроком</Typography>
                        <Typography sx={{ mt: 0.8, color: themeDraft.story.assistant_text_color, fontSize: '0.95rem', lineHeight: 1.45 }}>Текст генерируемый нейросетью</Typography>
                      </Box>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                        <FormControl fullWidth>
                          <Select value={themeDraft.story.font_family} onChange={(event: SelectChangeEvent<typeof themeDraft.story.font_family>) => setThemeDraft((previous) => ({ ...previous, story: { ...previous.story, font_family: event.target.value as EditableTheme['story']['font_family'] } }))} sx={{ borderRadius: '14px', backgroundColor: 'var(--morius-elevated-bg)' }}>
                            {storyHistoryFontFamilyOptions.map((option) => <MenuItem key={option.id} value={option.id}>{option.title}</MenuItem>)}
                          </Select>
                        </FormControl>
                        <FormControl fullWidth>
                          <Select value={themeDraft.story.font_weight} onChange={(event: SelectChangeEvent<typeof themeDraft.story.font_weight>) => setThemeDraft((previous) => ({ ...previous, story: { ...previous.story, font_weight: event.target.value as EditableTheme['story']['font_weight'] } }))} sx={{ borderRadius: '14px', backgroundColor: 'var(--morius-elevated-bg)' }}>
                            {storyHistoryFontWeightOptions.map((option) => <MenuItem key={option.id} value={option.id}>{option.title}</MenuItem>)}
                          </Select>
                        </FormControl>
                      </Stack>
                    </Stack>

                    <Stack spacing={1.15} sx={{ pl: { lg: 1.1 } }}>
                      {[...PALETTE_FIELDS, ...STORY_FIELDS].map((field) => {
                        const currentColor = isPaletteField(field.key) ? themeDraft.palette[field.key] : themeDraft.story[field.key]
                        const iconColor = resolveContrastColor(currentColor)
                        return (
                          <Box key={field.key} sx={{ display: 'grid', gap: 0.8, gridTemplateColumns: { xs: '1fr', md: '176px minmax(0, 1fr)' }, alignItems: { md: 'center' } }}>
                            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.98rem', fontWeight: 800, whiteSpace: 'nowrap' }}>{field.label}</Typography>
                            <Stack direction="row" spacing={0.55} useFlexGap flexWrap={{ xs: 'wrap', lg: 'nowrap' }} justifyContent={{ md: 'flex-start' }}>
                              {COLOR_SWATCHES.map((color) => {
                                const isActive = normalizeHexColor(currentColor) === normalizeHexColor(color)
                                return (
                                  <Button
                                    key={`${field.key}-${color}`}
                                    onClick={() => {
                                      setColorInputDraft(color)
                                      syncColorPickerInputValue(normalizeHexColor(color).toLowerCase())
                                      scheduleColorSelection(field.key, color)
                                    }}
                                    sx={{
                                      minWidth: 0,
                                      width: 36,
                                      height: 24,
                                      p: 0,
                                      borderRadius: '8px',
                                      border: 'none',
                                      backgroundColor: color,
                                      boxShadow: isActive
                                        ? '0 0 0 2px color-mix(in srgb, var(--morius-accent) 82%, white 18%), 0 10px 18px rgba(0, 0, 0, 0.18)'
                                        : '0 8px 16px rgba(0, 0, 0, 0.16)',
                                    }}
                                  />
                                )
                              })}
                              <Button
                                onClick={(event) => handleOpenColorPicker(event, field.key)}
                                sx={{
                                  minWidth: 0,
                                  width: 44,
                                  height: 24,
                                  p: 0,
                                  borderRadius: '8px',
                                  border: 'none',
                                  backgroundColor: currentColor,
                                  color: iconColor,
                                  boxShadow: '0 10px 18px rgba(0, 0, 0, 0.18)',
                                }}
                              >
                                <ThemedSvgIcon markup={eyedropperIconMarkup} size={14} />
                              </Button>
                            </Stack>
                          </Box>
                        )
                      })}
                    </Stack>
                  </Box>
                </Box>
              </Stack>
            )}
          </Box>
        </Box>
        </DialogContent>

        <Box
          sx={{
            px: mobileSheet.isMobileSheet ? 1.25 : 2.2,
            pt: mobileSheet.isMobileSheet ? 1 : 1.2,
            pb: mobileSheet.isMobileSheet ? 'calc(8px + env(safe-area-inset-bottom) + 8px)' : 1.2,
            borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
            backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 78%, #020304 22%)',
            boxShadow: '0 -10px 24px rgba(0, 0, 0, 0.18)',
            zIndex: 2,
          }}
        >
          {activeTab === 'profile' ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="flex-end">
              <Button onClick={onLogout} fullWidth={mobileSheet.isMobileSheet} sx={{ minHeight: 44, px: 2.2, borderRadius: '14px', textTransform: 'none', color: 'var(--morius-text-primary)', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-card-bg)' }}>
                Выйти
              </Button>
              <Button onClick={() => void handleSaveProfile()} fullWidth={mobileSheet.isMobileSheet} disabled={isSavingProfile} sx={{ minHeight: 44, px: 2.2, borderRadius: '14px', textTransform: 'none', color: 'var(--morius-title-text)', border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 54%, var(--morius-card-border))', backgroundColor: 'color-mix(in srgb, var(--morius-accent) 14%, var(--morius-card-bg))' }}>
                {isSavingProfile ? 'Сохраняем...' : 'Сохранить'}
              </Button>
            </Stack>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="flex-end">
              <Button onClick={handleResetDraft} fullWidth={mobileSheet.isMobileSheet} sx={{ minHeight: 44, px: 2.2, borderRadius: '14px', textTransform: 'none', color: 'var(--morius-text-primary)', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-card-bg)' }}>
                Сбросить
              </Button>
              <Button onClick={() => void handleSaveTheme()} fullWidth={mobileSheet.isMobileSheet} disabled={isSavingTheme} sx={{ minHeight: 44, px: 2.2, borderRadius: '14px', textTransform: 'none', color: 'var(--morius-title-text)', border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 54%, var(--morius-card-border))', backgroundColor: 'color-mix(in srgb, var(--morius-accent) 14%, var(--morius-card-bg))' }}>
                {isSavingTheme ? 'Сохраняем...' : 'Сохранить'}
              </Button>
            </Stack>
          )}
        </Box>
      </Box>

      <Popover
        open={Boolean(colorPickerAnchorEl && editingColorField)}
        anchorEl={colorPickerAnchorEl}
        onClose={handleCloseColorPicker}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { mt: 0.75, p: 1.1, borderRadius: '16px', border: 'none', backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 90%, var(--morius-elevated-bg) 10%)', boxShadow: '0 18px 40px rgba(0, 0, 0, 0.24)' } }}
      >
        <Stack spacing={1} sx={{ minWidth: 180 }}>
          <Box
            component="input"
            key={editingColorField ?? 'theme-color-picker'}
            ref={colorPickerInputRef}
            type="color"
            defaultValue={pickerColorValue}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              if (!editingColorField) {
                return
              }
              const nextValue = event.target.value
              setColorInputDraft(nextValue)
              scheduleColorSelection(editingColorField, nextValue)
            }}
            sx={{ width: '100%', height: 44, p: 0, border: 'none', borderRadius: '12px', background: 'transparent', cursor: 'pointer' }}
          />
          <TextField
            label="HEX"
            value={activeColorInputValue}
            onChange={(event) => {
              if (!editingColorField) {
                return
              }
              const nextValue = event.target.value.toUpperCase()
              setColorInputDraft(nextValue)
              if (!isCompleteHexColor(nextValue)) {
                return
              }
              syncColorPickerInputValue(normalizeHexColor(nextValue, activeFieldColor).toLowerCase())
              scheduleColorSelection(editingColorField, nextValue)
            }}
            onBlur={() => {
              if (!editingColorField) {
                return
              }
              const committedValue = isCompleteHexColor(activeColorInputValue)
                ? normalizeHexColor(activeColorInputValue, activeFieldColor)
                : activeFieldColor
              setColorInputDraft(committedValue)
              syncColorPickerInputValue(committedValue.toLowerCase())
              scheduleColorSelection(editingColorField, committedValue)
            }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px', backgroundColor: 'var(--morius-elevated-bg)' } }}
          />
        </Stack>
      </Popover>

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
              backgroundColor: 'color-mix(in srgb, var(--morius-accent) 18%, var(--morius-card-bg) 82%)',
            }}
          >
            {isReplacingAuthMethod ? 'Сохраняем...' : 'Включить вход по паролю'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(themeDeleteTarget)}
        onClose={() => {
          if (isSavingTheme) {
            return
          }
          setThemeDeleteTarget(null)
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
        <DialogTitle sx={{ fontWeight: 800 }}>Удалить тему?</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'var(--morius-text-secondary)', lineHeight: 1.45 }}>
            {themeDeleteTarget ? `Тема «${themeDeleteTarget.name}» будет удалена из вашего аккаунта. Это действие нельзя отменить.` : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={() => setThemeDeleteTarget(null)} disabled={isSavingTheme} sx={{ color: 'var(--morius-text-secondary)' }}>
            Отмена
          </Button>
          <Button
            onClick={() => void (themeDeleteTarget ? handleDeleteTheme(themeDeleteTarget.id) : Promise.resolve())}
            disabled={!themeDeleteTarget || isSavingTheme}
            sx={{
              minHeight: 40,
              px: 1.8,
              borderRadius: '12px',
              textTransform: 'none',
              color: 'var(--morius-title-text)',
              border: 'none',
              backgroundColor: 'color-mix(in srgb, var(--morius-accent) 18%, var(--morius-card-bg) 82%)',
            }}
          >
            {isSavingTheme ? 'Удаляем...' : 'Удалить'}
          </Button>
        </DialogActions>
      </Dialog>

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
              backgroundColor: 'color-mix(in srgb, var(--morius-accent) 18%, var(--morius-card-bg) 82%)',
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
