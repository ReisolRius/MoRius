import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  FormControl,
  MenuItem,
  Popover,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  type SelectChangeEvent,
} from '@mui/material'
import eyedropperIconMarkup from '../../assets/icons/eyedropper.svg?raw'
import editIconMarkup from '../../assets/icons/community-edit.svg?raw'
import {
  createCurrentUserCustomTheme,
  deleteCurrentUserCustomTheme,
  getCurrentUserThemeSettings,
  updateCurrentUserCustomTheme,
  updateCurrentUserProfile,
  updateCurrentUserProfilePrivacy,
  updateCurrentUserThemeSelection,
  type CurrentUserThemeSettings,
  type UserCustomTheme,
} from '../../services/authApi'
import type { AuthUser } from '../../types/auth'
import { getMoriusThemeById, moriusThemePresets, useMoriusThemeController, type MoriusThemePreset } from '../../theme'
import useMobileDialogSheet from '../dialogs/useMobileDialogSheet'
import ThemedSvgIcon from '../icons/ThemedSvgIcon'
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
const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'profile', label: 'Профиль' },
  { id: 'themes', label: 'Темы' },
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

function buildPresetFromCustomTheme(theme: UserCustomTheme): MoriusThemePreset {
  const fallback = getMoriusThemeById('classic-dark')
  return {
    ...fallback,
    id: theme.id,
    name: theme.name,
    subtitle: 'Пользовательская тема',
    description: theme.description || 'Пользовательская палитра',
    colors: {
      ...fallback.colors,
      titleText: theme.palette.title_text,
      textPrimary: theme.palette.text_primary,
      textSecondary: theme.story.player_text_color,
      appBackground: theme.palette.background,
      appBase: theme.palette.background,
      appSurface: theme.palette.surface,
      appElevated: theme.palette.surface,
      inputBg: theme.palette.input,
      accent: theme.palette.front,
      sendButton: theme.palette.front,
      panelGradient: theme.palette.surface,
      bootBackground: theme.palette.background,
      baseText: theme.story.player_text_color,
    },
    story: {
      correctedTextColor: theme.story.corrected_text_color,
      playerTextColor: theme.story.player_text_color,
      assistantTextColor: theme.story.assistant_text_color,
    },
  }
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
  onOpenTopUp: _onOpenTopUp,
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
  const [privacy, setPrivacy] = useState({
    show_subscriptions: user.show_subscriptions ?? false,
    show_public_worlds: user.show_public_worlds ?? false,
    show_private_worlds: user.show_private_worlds ?? false,
    show_public_characters: user.show_public_characters ?? false,
    show_public_instruction_templates: user.show_public_instruction_templates ?? false,
  })
  const [themeDraft, setThemeDraft] = useState<EditableTheme>(() => buildEditableThemeFromPreset(getMoriusThemeById('classic-dark')))
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null)
  const [editingColorField, setEditingColorField] = useState<ColorFieldKey | null>(null)
  const [colorInputDraft, setColorInputDraft] = useState('')
  const [colorPickerAnchorEl, setColorPickerAnchorEl] = useState<HTMLElement | null>(null)
  const colorPickerInputRef = useRef<HTMLInputElement | null>(null)
  const colorSelectionFrameRef = useRef<number | null>(null)
  const pendingColorSelectionRef = useRef<{ field: ColorFieldKey; color: string } | null>(null)
  const { themeId, activeTheme, setTheme, setCustomTheme, setStoryHistoryFontFamily, setStoryHistoryFontWeight, storyHistoryFontFamilyOptions, storyHistoryFontWeightOptions } = useMoriusThemeController()
  const savedCustomThemes = themeSettings?.custom_themes ?? []
  const activeSavedCustomTheme = useMemo(
    () => (themeSettings?.active_theme_kind === 'custom' ? savedCustomThemes.find((item) => item.id === themeSettings.active_theme_id) ?? null : null),
    [savedCustomThemes, themeSettings],
  )

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
    setDisplayName(user.display_name ?? '')
    setProfileDescription(user.profile_description ?? '')
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

  const handleDialogClose = () => {
    applyResolvedTheme(themeSettings)
    handleCloseColorPicker()
    setError('')
    onClose()
  }
  const mobileSheet = useMobileDialogSheet({ onClose: handleDialogClose })

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
        notifications_enabled: notifications.notifications_enabled,
        notify_comment_reply: notifications.notify_comment_reply,
        notify_world_comment: notifications.notify_world_comment,
        notify_publication_review: notifications.notify_publication_review,
        notify_new_follower: notifications.notify_new_follower,
        notify_moderation_report: notifications.notify_moderation_report,
        notify_moderation_queue: notifications.notify_moderation_queue,
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
    setIsSavingTheme(true)
    try {
      const payload = buildCustomThemeFromDraft(themeDraft)
      const themeExists = savedCustomThemes.some((item) => item.id === payload.id)
      const response = themeExists
        ? await updateCurrentUserCustomTheme({ token: authToken, theme: payload })
        : await createCurrentUserCustomTheme({ token: authToken, theme: payload })
      setThemeSettings(response)
      setEditingThemeId(payload.id)
      setThemeDraft(buildEditableThemeFromCustom(payload))
      applyResolvedTheme(response)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось сохранить тему'
      setError(detail)
    } finally {
      setIsSavingTheme(false)
    }
  }

  const handleDeleteTheme = async () => {
    if (!editingThemeId || isSavingTheme || !savedCustomThemes.some((item) => item.id === editingThemeId)) {
      return
    }
    setError('')
    setIsSavingTheme(true)
    try {
      const response = await deleteCurrentUserCustomTheme({ token: authToken, theme_id: editingThemeId })
      setThemeSettings(response)
      setEditingThemeId(null)
      setThemeDraft(buildEditableThemeFromPreset(getMoriusThemeById(response.active_theme_id)))
      applyResolvedTheme(response)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось удалить тему'
      setError(detail)
    } finally {
      setIsSavingTheme(false)
    }
  }

  const handleResetDraft = () => {
    if (activeSavedCustomTheme) {
      setEditingThemeId(activeSavedCustomTheme.id)
      setThemeDraft(buildEditableThemeFromCustom(activeSavedCustomTheme))
      return
    }
    setEditingThemeId(null)
    setThemeDraft(buildEditableThemeFromPreset(getMoriusThemeById(themeSettings?.active_theme_id ?? themeId)))
    applyResolvedTheme(themeSettings)
  }

  const activeFieldColor = editingColorField ? (isPaletteField(editingColorField) ? themeDraft.palette[editingColorField] : themeDraft.story[editingColorField]) : '#578EEE'
  const activeColorInputValue = colorInputDraft || activeFieldColor
  const pickerColorValue = normalizeHexColor(activeColorInputValue, activeFieldColor).toLowerCase()
  const isCurrentDraftSavedCustom = Boolean(editingThemeId && savedCustomThemes.some((item) => item.id === editingThemeId))
  const previewDescription = profileDescription.trim() || 'Краткое описание профиля'

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
      <DialogContent sx={{ p: 0, minHeight: 0, backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 38%, #020304 62%)' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: mobileSheet.isMobileSheet ? '1fr' : { xs: '1fr', md: '280px minmax(0, 1fr)' },
            minHeight: mobileSheet.isMobileSheet ? 'auto' : 'min(920px, calc(100vh - 24px))',
          }}
        >
          <Box
            sx={{
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
                    onClick={handleDialogClose}
                    disableRipple
                    sx={{
                      display: mobileSheet.isMobileSheet ? 'none' : 'inline-flex',
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
                    borderRadius: '20px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 72%, #030405 28%)',
                    p: { xs: 1.2, md: 1.35 },
                  }}
                >
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                    <Box sx={{ position: 'relative', width: { xs: 76, sm: 88 }, height: { xs: 76, sm: 88 }, flexShrink: 0 }}>
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
                            overflow: 'hidden',
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
                          <UserAvatar user={user} size={mobileSheet.isMobileSheet ? 76 : 88} />
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
                        <UserAvatar user={user} size={mobileSheet.isMobileSheet ? 76 : 88} />
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
                  </Stack>

                  <Box sx={{ borderRadius: '18px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-card-bg)', p: 1.35, alignSelf: 'start' }}>
                    <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800, mb: 1 }}>Уведомления</Typography>
                    <Stack spacing={0.9}>
                      {NOTIFICATION_FIELDS.map((item) => (
                        <SettingsSwitchRow key={item.key} label={item.label} checked={notifications[item.key]} onChange={(checked) => setNotifications((previous) => ({ ...previous, [item.key]: checked }))} />
                      ))}
                    </Stack>
                  </Box>
                </Box>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="flex-end">
                  <Button onClick={onLogout} fullWidth={mobileSheet.isMobileSheet} sx={{ minHeight: 46, px: 2.2, borderRadius: '14px', textTransform: 'none', color: 'var(--morius-text-primary)', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-card-bg)' }}>
                    Выйти
                  </Button>
                  <Button onClick={() => void handleSaveProfile()} fullWidth={mobileSheet.isMobileSheet} disabled={isSavingProfile} sx={{ minHeight: 46, px: 2.2, borderRadius: '14px', textTransform: 'none', color: 'var(--morius-title-text)', border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 54%, var(--morius-card-border))', backgroundColor: 'color-mix(in srgb, var(--morius-accent) 14%, var(--morius-card-bg))' }}>
                    {isSavingProfile ? 'Сохраняем...' : 'Сохранить'}
                  </Button>
                </Stack>
              </Stack>
            ) : (
              <Stack spacing={1.6}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={1}>
                  <Typography sx={{ color: 'var(--morius-accent)', fontSize: { xs: '2.2rem', md: '2.7rem' }, fontWeight: 900, lineHeight: 1 }}>Темы</Typography>
                  <Button
                    onClick={handleDialogClose}
                    disableRipple
                    sx={{
                      display: mobileSheet.isMobileSheet ? 'none' : 'inline-flex',
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
                  <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 800 }}>Готовые темы</Typography>
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
                    <Button
                      onClick={handleStartNewTheme}
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
                      }}
                    >
                      <Stack spacing={0.55} alignItems="center">
                        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '2rem', fontWeight: 400, lineHeight: 1 }}>+</Typography>
                        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.96rem', fontWeight: 800 }}>Новая тема</Typography>
                      </Stack>
                    </Button>
                  </Box>
                </Stack>

                {savedCustomThemes.length > 0 ? (
                  <Stack spacing={0.9}>
                    <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 800 }}>Пользовательские темы</Typography>
                    <Box sx={{ display: 'grid', gap: 0.8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                      {savedCustomThemes.map((theme) => {
                        const isActive = themeSettings?.active_theme_kind === 'custom' && themeSettings.active_theme_id === theme.id
                        return (
                          <Box
                            key={theme.id}
                            sx={{
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
                            <Stack spacing={0.7}>
                              <Stack direction="row" spacing={0.45}>
                                {[theme.palette.title_text, theme.palette.text_primary, theme.palette.background, theme.palette.surface, theme.palette.front].map((color, index) => (
                                  <Box key={`${theme.id}-custom-${index}`} sx={{ width: 18, height: 18, borderRadius: '50%', backgroundColor: color, border: 'var(--morius-border-width) solid rgba(255,255,255,0.16)' }} />
                                ))}
                              </Stack>
                              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 800 }}>{theme.name}</Typography>
                              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.83rem', lineHeight: 1.35 }}>{theme.description || 'Пользовательская палитра'}</Typography>
                              <Stack direction="row" spacing={0.7}>
                                <Button
                                  onClick={() => void updateCurrentUserThemeSelection({ token: authToken, active_theme_kind: 'custom', active_theme_id: theme.id }).then((response) => { setThemeSettings(response); applyResolvedTheme(response) }).catch((requestError) => { const detail = requestError instanceof Error ? requestError.message : 'Не удалось применить тему'; setError(detail) })}
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
                    </Box>
                  </Stack>
                ) : null}

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

                      <Stack direction="row" spacing={0.8} justifyContent="flex-end" sx={{ pt: 0.4 }}>
                        <Button onClick={handleResetDraft} sx={{ minHeight: 42, px: 1.8, borderRadius: '14px', textTransform: 'none', color: 'var(--morius-text-primary)', border: 'none', backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, var(--morius-card-bg) 18%)' }}>Сбросить</Button>
                        {isCurrentDraftSavedCustom ? <Button onClick={() => void handleDeleteTheme()} disabled={isSavingTheme} sx={{ minHeight: 42, px: 1.8, borderRadius: '14px', textTransform: 'none', color: 'var(--morius-text-primary)', border: 'none', backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, var(--morius-card-bg) 18%)' }}>Удалить</Button> : null}
                        <Button onClick={() => void handleSaveTheme()} disabled={isSavingTheme} sx={{ minHeight: 42, px: 1.8, borderRadius: '14px', textTransform: 'none', color: 'var(--morius-title-text)', border: 'none', backgroundColor: 'color-mix(in srgb, var(--morius-accent) 18%, var(--morius-card-bg) 82%)' }}>
                          {isSavingTheme ? 'Сохраняем...' : 'Сохранить'}
                        </Button>
                      </Stack>
                    </Stack>
                  </Box>
                </Box>
              </Stack>
            )}
          </Box>
        </Box>
      </DialogContent>

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
    </Dialog>
  )
}

export default SettingsDialog
