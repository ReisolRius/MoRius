import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CommunityWorldDialog from '../community/CommunityWorldDialog'
import {
  banUserAsAdmin,
  dismissCharacterReportsAsAdmin,
  dismissInstructionTemplateReportsAsAdmin,
  dismissWorldReportsAsAdmin,
  listOpenReportsForAdmin,
  removeCharacterFromCommunityAsAdmin,
  removeInstructionTemplateFromCommunityAsAdmin,
  removeWorldFromCommunityAsAdmin,
  searchUsersForAdminPanel,
  unbanUserAsAdmin,
  updateUserTokensAsAdmin,
  type AdminManagedUser,
  type AdminReport,
  type AdminReportReason,
  type AdminReportTargetType,
} from '../../services/authApi'
import {
  getCommunityCharacter,
  getCommunityInstructionTemplate,
  getCommunityWorld,
} from '../../services/storyApi'
import type {
  StoryCommunityCharacterSummary,
  StoryCommunityInstructionTemplateSummary,
  StoryCommunityWorldPayload,
} from '../../types/story'

const ADMIN_PANEL_EMAIL_ALLOWLIST = new Set(['alexunderstood8@gmail.com', 'borisow.n2011@gmail.com'])

type AdminPanelTab = 'users' | 'reports'

type AdminPanelDialogProps = {
  open: boolean
  authToken: string
  currentUserEmail: string
  onClose: () => void
}

function formatBanLabel(user: AdminManagedUser): string {
  if (!user.is_banned) {
    return `${user.coins.toLocaleString('ru-RU')} солов`
  }
  if (!user.ban_expires_at) {
    return 'В бане'
  }
  const parsed = new Date(user.ban_expires_at)
  if (Number.isNaN(parsed.getTime())) {
    return 'В бане'
  }
  return `В бане до ${parsed.toLocaleString('ru-RU')}`
}

function formatReportReasonLabel(reason: AdminReportReason): string {
  if (reason === 'cp') {
    return 'ЦП'
  }
  if (reason === 'politics') {
    return 'Политика'
  }
  if (reason === 'racism') {
    return 'Расизм'
  }
  if (reason === 'nationalism') {
    return 'Национализм'
  }
  return 'Другое'
}

function formatReportTargetLabel(targetType: AdminReportTargetType): string {
  if (targetType === 'world') {
    return 'Мир'
  }
  if (targetType === 'character') {
    return 'Персонаж'
  }
  return 'Инструкция'
}

function formatRemoveActionLabel(targetType: AdminReportTargetType): string {
  if (targetType === 'world') {
    return 'Удалить мир'
  }
  if (targetType === 'character') {
    return 'Удалить персонажа'
  }
  return 'Удалить инструкцию'
}

function formatReportDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return '—'
  }
  return parsed.toLocaleString('ru-RU')
}

function getReportDescriptionPreview(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'Без описания'
  }
  if (normalized.length <= 110) {
    return normalized
  }
  return `${normalized.slice(0, 107)}...`
}

function buildReportKey(report: AdminReport): string {
  return `${report.target_type}:${report.target_id}`
}

function getAvatarFallbackLabel(value: string): string {
  const normalized = value.trim()
  if (!normalized) {
    return '•'
  }
  return normalized.charAt(0).toUpperCase()
}

function AdminPanelDialog({ open, authToken, currentUserEmail, onClose }: AdminPanelDialogProps) {
  const [activeTab, setActiveTab] = useState<AdminPanelTab>('users')
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminManagedUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [tokenAmountDraft, setTokenAmountDraft] = useState('100')
  const [banDurationDraft, setBanDurationDraft] = useState('24')
  const [banDurationUnit, setBanDurationUnit] = useState<'hours' | 'days'>('hours')
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [isApplyingUserAction, setIsApplyingUserAction] = useState(false)

  const [reports, setReports] = useState<AdminReport[]>([])
  const [selectedReportKey, setSelectedReportKey] = useState<string | null>(null)
  const [isLoadingReports, setIsLoadingReports] = useState(false)
  const [isApplyingReportAction, setIsApplyingReportAction] = useState(false)
  const [selectedReportWorldPayload, setSelectedReportWorldPayload] = useState<StoryCommunityWorldPayload | null>(null)
  const [selectedReportCharacterPayload, setSelectedReportCharacterPayload] = useState<StoryCommunityCharacterSummary | null>(
    null,
  )
  const [selectedReportInstructionPayload, setSelectedReportInstructionPayload] =
    useState<StoryCommunityInstructionTemplateSummary | null>(null)
  const [isLoadingReportTarget, setIsLoadingReportTarget] = useState(false)

  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const canUseAdminPanel = useMemo(
    () => ADMIN_PANEL_EMAIL_ALLOWLIST.has(currentUserEmail.trim().toLowerCase()),
    [currentUserEmail],
  )

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  )

  const selectedReport = useMemo(
    () => reports.find((report) => buildReportKey(report) === selectedReportKey) ?? null,
    [reports, selectedReportKey],
  )

  const resetSelectedReportTargetPayloads = useCallback(() => {
    setSelectedReportWorldPayload(null)
    setSelectedReportCharacterPayload(null)
    setSelectedReportInstructionPayload(null)
  }, [])

  const mergeUpdatedUser = useCallback((updatedUser: AdminManagedUser) => {
    setUsers((previous) => {
      const nextUsers = previous.map((user) => (user.id === updatedUser.id ? updatedUser : user))
      if (!nextUsers.some((user) => user.id === updatedUser.id)) {
        nextUsers.unshift(updatedUser)
      }
      return nextUsers
    })
    setSelectedUserId(updatedUser.id)
  }, [])

  const loadUsers = useCallback(
    async (searchValue: string) => {
      if (!open || !canUseAdminPanel) {
        return
      }
      setIsLoadingUsers(true)
      setErrorMessage('')
      try {
        const response = await searchUsersForAdminPanel({
          token: authToken,
          query: searchValue,
          limit: 50,
        })
        setUsers(response)
        if (response.length === 0) {
          setSelectedUserId(null)
          return
        }
        setSelectedUserId((previous) => (previous && response.some((user) => user.id === previous) ? previous : response[0].id))
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить пользователей'
        setErrorMessage(detail)
        setUsers([])
        setSelectedUserId(null)
      } finally {
        setIsLoadingUsers(false)
      }
    },
    [authToken, canUseAdminPanel, open],
  )

  const loadReports = useCallback(async () => {
    if (!open || !canUseAdminPanel) {
      return
    }
    setIsLoadingReports(true)
    setErrorMessage('')
    try {
      const response = await listOpenReportsForAdmin({
        token: authToken,
      })
      setReports(response)
      if (response.length === 0) {
        setSelectedReportKey(null)
        resetSelectedReportTargetPayloads()
        return
      }
      setSelectedReportKey((previous) => {
        if (previous && response.some((report) => buildReportKey(report) === previous)) {
          return previous
        }
        return buildReportKey(response[0])
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить жалобы'
      setErrorMessage(detail)
      setReports([])
      setSelectedReportKey(null)
      resetSelectedReportTargetPayloads()
    } finally {
      setIsLoadingReports(false)
    }
  }, [authToken, canUseAdminPanel, open, resetSelectedReportTargetPayloads])

  useEffect(() => {
    if (!open) {
      return
    }
    setErrorMessage('')
    setSuccessMessage('')
    if (activeTab === 'users') {
      void loadUsers(query)
      return
    }
    void loadReports()
  }, [activeTab, loadReports, loadUsers, open, query])

  useEffect(() => {
    if (!open) {
      resetSelectedReportTargetPayloads()
      return
    }
    setActiveTab('users')
    setQuery('')
    setUsers([])
    setSelectedUserId(null)
    setTokenAmountDraft('100')
    setBanDurationDraft('24')
    setBanDurationUnit('hours')
    setReports([])
    setSelectedReportKey(null)
    resetSelectedReportTargetPayloads()
    setErrorMessage('')
    setSuccessMessage('')
  }, [open, resetSelectedReportTargetPayloads])

  const handleUpdateTokens = useCallback(
    async (operation: 'add' | 'subtract') => {
      if (!selectedUser) {
        setErrorMessage('Выберите пользователя')
        return
      }
      const parsedAmount = Number.parseInt(tokenAmountDraft.trim(), 10)
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setErrorMessage('Укажите корректное количество солов')
        return
      }

      setIsApplyingUserAction(true)
      setErrorMessage('')
      setSuccessMessage('')
      try {
        const updatedUser = await updateUserTokensAsAdmin({
          token: authToken,
          user_id: selectedUser.id,
          operation,
          amount: parsedAmount,
        })
        mergeUpdatedUser(updatedUser)
        setSuccessMessage(operation === 'add' ? 'Солы начислены' : 'Солы списаны')
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось изменить баланс'
        setErrorMessage(detail)
      } finally {
        setIsApplyingUserAction(false)
      }
    },
    [authToken, mergeUpdatedUser, selectedUser, tokenAmountDraft],
  )

  const handleBan = useCallback(async () => {
    if (!selectedUser) {
      setErrorMessage('Выберите пользователя')
      return
    }

    const parsedDuration = Number.parseInt(banDurationDraft.trim(), 10)
    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      setErrorMessage('Укажите корректную длительность бана')
      return
    }

    const durationHours = banDurationUnit === 'days' ? parsedDuration * 24 : parsedDuration
    setIsApplyingUserAction(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const updatedUser = await banUserAsAdmin({
        token: authToken,
        user_id: selectedUser.id,
        duration_hours: durationHours,
      })
      mergeUpdatedUser(updatedUser)
      setSuccessMessage('Пользователь заблокирован')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось выдать бан'
      setErrorMessage(detail)
    } finally {
      setIsApplyingUserAction(false)
    }
  }, [authToken, banDurationDraft, banDurationUnit, mergeUpdatedUser, selectedUser])

  const handleUnban = useCallback(async () => {
    if (!selectedUser) {
      setErrorMessage('Выберите пользователя')
      return
    }

    setIsApplyingUserAction(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const updatedUser = await unbanUserAsAdmin({
        token: authToken,
        user_id: selectedUser.id,
      })
      mergeUpdatedUser(updatedUser)
      setSuccessMessage('Пользователь разблокирован')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось снять бан'
      setErrorMessage(detail)
    } finally {
      setIsApplyingUserAction(false)
    }
  }, [authToken, mergeUpdatedUser, selectedUser])

  const handleOpenReportedTarget = useCallback(
    async (report: AdminReport) => {
      if (isLoadingReportTarget || isApplyingReportAction) {
        return
      }
      setSelectedReportKey(buildReportKey(report))
      resetSelectedReportTargetPayloads()
      setIsLoadingReportTarget(true)
      setErrorMessage('')
      try {
        if (report.target_type === 'world') {
          const payload = await getCommunityWorld({
            token: authToken,
            worldId: report.target_id,
          })
          setSelectedReportWorldPayload(payload)
          return
        }
        if (report.target_type === 'character') {
          const payload = await getCommunityCharacter({
            token: authToken,
            characterId: report.target_id,
          })
          setSelectedReportCharacterPayload(payload)
          return
        }
        const payload = await getCommunityInstructionTemplate({
          token: authToken,
          templateId: report.target_id,
        })
        setSelectedReportInstructionPayload(payload)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось открыть контент по жалобе'
        setErrorMessage(detail)
      } finally {
        setIsLoadingReportTarget(false)
      }
    },
    [authToken, isApplyingReportAction, isLoadingReportTarget, resetSelectedReportTargetPayloads],
  )

  const handleDismissReport = useCallback(async () => {
    if (!selectedReport || isApplyingReportAction) {
      return
    }
    setIsApplyingReportAction(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const response =
        selectedReport.target_type === 'world'
          ? await dismissWorldReportsAsAdmin({
              token: authToken,
              world_id: selectedReport.target_id,
            })
          : selectedReport.target_type === 'character'
            ? await dismissCharacterReportsAsAdmin({
                token: authToken,
                character_id: selectedReport.target_id,
              })
            : await dismissInstructionTemplateReportsAsAdmin({
                token: authToken,
                template_id: selectedReport.target_id,
              })
      setSuccessMessage(response.message || 'Жалоба отклонена')
      resetSelectedReportTargetPayloads()
      await loadReports()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось отклонить жалобу'
      setErrorMessage(detail)
    } finally {
      setIsApplyingReportAction(false)
    }
  }, [authToken, isApplyingReportAction, loadReports, resetSelectedReportTargetPayloads, selectedReport])

  const handleRemoveReportedTarget = useCallback(async () => {
    if (!selectedReport || isApplyingReportAction) {
      return
    }
    setIsApplyingReportAction(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const response =
        selectedReport.target_type === 'world'
          ? await removeWorldFromCommunityAsAdmin({
              token: authToken,
              world_id: selectedReport.target_id,
            })
          : selectedReport.target_type === 'character'
            ? await removeCharacterFromCommunityAsAdmin({
                token: authToken,
                character_id: selectedReport.target_id,
              })
            : await removeInstructionTemplateFromCommunityAsAdmin({
                token: authToken,
                template_id: selectedReport.target_id,
              })
      setSuccessMessage(response.message || 'Контент удален')
      resetSelectedReportTargetPayloads()
      await loadReports()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось удалить контент'
      setErrorMessage(detail)
    } finally {
      setIsApplyingReportAction(false)
    }
  }, [authToken, isApplyingReportAction, loadReports, resetSelectedReportTargetPayloads, selectedReport])

  const handleCloseTargetDialog = useCallback(() => {
    if (isLoadingReportTarget || isApplyingReportAction) {
      return
    }
    resetSelectedReportTargetPayloads()
  }, [isApplyingReportAction, isLoadingReportTarget, resetSelectedReportTargetPayloads])

  const isWorldReportDialogOpen = Boolean(
    selectedReport?.target_type === 'world' && (selectedReportWorldPayload || isLoadingReportTarget),
  )
  const isCharacterReportDialogOpen = Boolean(
    selectedReport?.target_type === 'character' && (selectedReportCharacterPayload || isLoadingReportTarget),
  )
  const isInstructionReportDialogOpen = Boolean(
    selectedReport?.target_type === 'instruction_template' && (selectedReportInstructionPayload || isLoadingReportTarget),
  )

  const reportActionDisabled =
    !selectedReport ||
    isApplyingReportAction ||
    isLoadingReportTarget ||
    (!selectedReportWorldPayload && !selectedReportCharacterPayload && !selectedReportInstructionPayload)

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 'var(--morius-radius)',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            boxShadow: '0 28px 70px rgba(0, 0, 0, 0.58)',
          },
        }}
        BackdropProps={{
          sx: {
            backgroundColor: 'rgba(2, 4, 8, 0.8)',
            backdropFilter: 'blur(5px)',
          },
        }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pb: 1.1,
          }}
        >
          <Stack spacing={0.2}>
            <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>Панель администратора</Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.86rem' }}>
              Управление пользователями и жалобами
            </Typography>
          </Stack>
          <IconButton
            onClick={onClose}
            aria-label="Закрыть админку"
            sx={{
              width: 34,
              height: 34,
              border: 'var(--morius-border-width) solid rgba(193, 205, 221, 0.34)',
              color: 'var(--morius-text-secondary)',
            }}
          >
            X
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.5 }}>
          <Stack spacing={1.5}>
            {!canUseAdminPanel ? <Alert severity="error">Доступ к админ-панели запрещен для этого аккаунта</Alert> : null}
            {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
            {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}

            <Stack direction="row" spacing={1}>
              <Button
                variant={activeTab === 'users' ? 'contained' : 'outlined'}
                onClick={() => setActiveTab('users')}
                disabled={!canUseAdminPanel || isApplyingUserAction || isApplyingReportAction}
                sx={{
                  textTransform: 'none',
                  borderRadius: 'var(--morius-radius)',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                }}
              >
                Пользователи
              </Button>
              <Button
                variant={activeTab === 'reports' ? 'contained' : 'outlined'}
                onClick={() => setActiveTab('reports')}
                disabled={!canUseAdminPanel || isApplyingUserAction || isApplyingReportAction}
                sx={{
                  textTransform: 'none',
                  borderRadius: 'var(--morius-radius)',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                }}
              >
                Жалобы
              </Button>
            </Stack>

            {activeTab === 'users' ? (
              <Stack spacing={1.2}>
                <TextField
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Введите email или ник"
                  size="small"
                  disabled={!canUseAdminPanel || isApplyingUserAction}
                />

                <Box
                  className="morius-scrollbar"
                  sx={{
                    borderRadius: '12px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-card-bg)',
                    maxHeight: 230,
                    overflowY: 'auto',
                    p: 0.8,
                  }}
                >
                  {isLoadingUsers ? (
                    <Stack alignItems="center" justifyContent="center" sx={{ py: 2.2 }}>
                      <CircularProgress size={24} />
                    </Stack>
                  ) : users.length === 0 ? (
                    <Typography sx={{ color: 'text.secondary', px: 0.8, py: 1 }}>Пользователи не найдены</Typography>
                  ) : (
                    <Stack spacing={0.8}>
                      {users.map((user) => {
                        const isSelected = user.id === selectedUserId
                        return (
                          <Button
                            key={user.id}
                            onClick={() => setSelectedUserId(user.id)}
                            sx={{
                              justifyContent: 'space-between',
                              textTransform: 'none',
                              borderRadius: '10px',
                              border: 'var(--morius-border-width) solid',
                              borderColor: isSelected ? 'rgba(219, 230, 245, 0.52)' : 'rgba(184, 199, 214, 0.2)',
                              backgroundColor: isSelected ? 'rgba(37, 52, 70, 0.4)' : 'rgba(22, 30, 40, 0.34)',
                              color: 'var(--morius-text-primary)',
                              px: 1.2,
                              py: 1,
                              '&:hover': {
                                backgroundColor: 'rgba(46, 62, 82, 0.42)',
                              },
                            }}
                          >
                            <Stack spacing={0.1} sx={{ minWidth: 0, alignItems: 'flex-start' }}>
                              <Typography sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
                                {user.display_name || user.email}
                              </Typography>
                              <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }} noWrap>
                                {user.email} · {user.role}
                              </Typography>
                            </Stack>
                            <Typography sx={{ color: 'text.secondary', ml: 1.2, fontSize: '0.85rem' }}>
                              {formatBanLabel(user)}
                            </Typography>
                          </Button>
                        )
                      })}
                    </Stack>
                  )}
                </Box>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    value={tokenAmountDraft}
                    onChange={(event) => setTokenAmountDraft(event.target.value)}
                    label="Сумма солов"
                    size="small"
                    disabled={!selectedUser || isApplyingUserAction || !canUseAdminPanel}
                    inputProps={{ inputMode: 'numeric' }}
                    sx={{ flex: 1 }}
                  />
                  <Button
                    variant="outlined"
                    onClick={() => void handleUpdateTokens('subtract')}
                    disabled={!selectedUser || isApplyingUserAction || !canUseAdminPanel}
                    sx={{
                      minHeight: 40,
                      borderColor: 'rgba(188, 202, 221, 0.36)',
                      color: 'var(--morius-text-primary)',
                    }}
                  >
                    Списать
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => void handleUpdateTokens('add')}
                    disabled={!selectedUser || isApplyingUserAction || !canUseAdminPanel}
                    sx={{
                      minHeight: 40,
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-button-active)',
                    }}
                  >
                    Выдать
                  </Button>
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    value={banDurationDraft}
                    onChange={(event) => setBanDurationDraft(event.target.value)}
                    label="Длительность"
                    size="small"
                    disabled={!selectedUser || isApplyingUserAction || !canUseAdminPanel}
                    inputProps={{ inputMode: 'numeric' }}
                    sx={{ flex: 1 }}
                  />
                  <Select
                    value={banDurationUnit}
                    onChange={(event) => setBanDurationUnit(event.target.value as 'hours' | 'days')}
                    size="small"
                    disabled={!selectedUser || isApplyingUserAction || !canUseAdminPanel}
                    sx={{ minWidth: 132 }}
                  >
                    <MenuItem value="hours">Часы</MenuItem>
                    <MenuItem value="days">Дни</MenuItem>
                  </Select>
                  <Button
                    variant="outlined"
                    onClick={() => void handleUnban()}
                    disabled={!selectedUser || isApplyingUserAction || !canUseAdminPanel}
                    sx={{
                      minHeight: 40,
                      borderColor: 'rgba(188, 202, 221, 0.36)',
                      color: 'var(--morius-text-primary)',
                    }}
                  >
                    Разбан
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => void handleBan()}
                    disabled={!selectedUser || isApplyingUserAction || !canUseAdminPanel}
                    sx={{
                      minHeight: 40,
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'rgba(192, 91, 91, 0.38)',
                      '&:hover': {
                        backgroundColor: 'rgba(199, 102, 102, 0.5)',
                      },
                    }}
                  >
                    Забанить
                  </Button>
                </Stack>
              </Stack>
            ) : (
              <Stack spacing={1.2}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.86rem' }}>Открытые жалобы</Typography>
                  <Button
                    variant="outlined"
                    onClick={() => void loadReports()}
                    disabled={!canUseAdminPanel || isLoadingReports || isApplyingReportAction}
                    sx={{
                      minHeight: 32,
                      textTransform: 'none',
                      borderColor: 'rgba(188, 202, 221, 0.36)',
                      color: 'var(--morius-text-primary)',
                    }}
                  >
                    Обновить
                  </Button>
                </Stack>

                <Box
                  className="morius-scrollbar"
                  sx={{
                    borderRadius: '12px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-card-bg)',
                    maxHeight: 280,
                    overflowY: 'auto',
                    p: 0.8,
                  }}
                >
                  {isLoadingReports ? (
                    <Stack alignItems="center" justifyContent="center" sx={{ py: 2.2 }}>
                      <CircularProgress size={24} />
                    </Stack>
                  ) : reports.length === 0 ? (
                    <Typography sx={{ color: 'text.secondary', px: 0.8, py: 1 }}>Нет открытых жалоб</Typography>
                  ) : (
                    <Stack spacing={0.8}>
                      {reports.map((report) => {
                        const isSelected = buildReportKey(report) === selectedReportKey
                        return (
                          <Button
                            key={buildReportKey(report)}
                            onClick={() => void handleOpenReportedTarget(report)}
                            disabled={isApplyingReportAction}
                            sx={{
                              justifyContent: 'space-between',
                              textTransform: 'none',
                              borderRadius: '10px',
                              border: 'var(--morius-border-width) solid',
                              borderColor: isSelected ? 'rgba(219, 230, 245, 0.52)' : 'rgba(184, 199, 214, 0.2)',
                              backgroundColor: isSelected ? 'rgba(37, 52, 70, 0.4)' : 'rgba(22, 30, 40, 0.34)',
                              color: 'var(--morius-text-primary)',
                              px: 1.2,
                              py: 1,
                              '&:hover': {
                                backgroundColor: 'rgba(46, 62, 82, 0.42)',
                              },
                            }}
                          >
                            <Stack spacing={0.2} sx={{ minWidth: 0, alignItems: 'flex-start' }}>
                              <Typography sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
                                {report.target_title}
                              </Typography>
                              <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }} noWrap>
                                {formatReportTargetLabel(report.target_type)} · {report.target_author_name} ·{' '}
                                {formatReportReasonLabel(report.latest_reason)} · {formatReportDate(report.latest_created_at)}
                              </Typography>
                              <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }} noWrap>
                                {getReportDescriptionPreview(report.latest_description)}
                              </Typography>
                            </Stack>
                            <Typography sx={{ color: 'text.secondary', ml: 1.2, fontSize: '0.82rem' }}>
                              Жалоб: {report.open_reports_count}
                            </Typography>
                          </Button>
                        )
                      })}
                    </Stack>
                  )}
                </Box>
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.3, pt: 0.5 }}>
          <Button onClick={onClose} sx={{ color: 'text.secondary' }}>
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

      <CommunityWorldDialog
        open={open && isWorldReportDialogOpen}
        isLoading={isLoadingReportTarget}
        worldPayload={selectedReportWorldPayload}
        ratingDraft={selectedReportWorldPayload?.world.user_rating ?? 0}
        isRatingSaving={false}
        isLaunching={false}
        isInMyGames={false}
        isMyGamesToggleSaving={false}
        onClose={handleCloseTargetDialog}
        onPlay={() => {
          // Admin moderation mode does not launch worlds.
        }}
        onRate={() => {
          // Admin moderation mode does not save ratings.
        }}
        onToggleMyGames={() => {
          // Admin moderation mode does not manage personal games.
        }}
        showGameplayActions={false}
        moderationControls={
          selectedReport && selectedReport.target_type === 'world'
            ? {
                reportCount: selectedReport.open_reports_count,
                reasonLabel: formatReportReasonLabel(selectedReport.latest_reason),
                description: selectedReport.latest_description,
                isApplying: isApplyingReportAction,
                onRemoveWorld: () => void handleRemoveReportedTarget(),
                onDismissReport: () => void handleDismissReport(),
              }
            : null
        }
      />

      <Dialog
        open={open && isCharacterReportDialogOpen}
        onClose={handleCloseTargetDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 'var(--morius-radius)',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            color: 'var(--morius-text-primary)',
            boxShadow: '0 28px 70px rgba(0, 0, 0, 0.58)',
          },
        }}
        BackdropProps={{
          sx: {
            backgroundColor: 'rgba(2, 4, 8, 0.8)',
            backdropFilter: 'blur(5px)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 0.9 }}>
          {selectedReportCharacterPayload?.name || selectedReport?.target_title || 'Персонаж'}
        </DialogTitle>
        <DialogContent sx={{ pt: 0.4 }}>
          {isLoadingReportTarget || !selectedReportCharacterPayload ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 3 }}>
              <CircularProgress size={26} />
            </Stack>
          ) : (
            <Stack spacing={1.15}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Avatar
                  src={selectedReportCharacterPayload.avatar_url || undefined}
                  alt={selectedReportCharacterPayload.name}
                  sx={{
                    width: 54,
                    height: 54,
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-elevated-bg)',
                    color: 'var(--morius-text-primary)',
                    fontWeight: 800,
                  }}
                  imgProps={{
                    style: {
                      objectFit: 'cover',
                      transform: `scale(${Math.max(1, Math.min(3, selectedReportCharacterPayload.avatar_scale || 1))})`,
                      transformOrigin: 'center center',
                    },
                  }}
                >
                  {getAvatarFallbackLabel(selectedReportCharacterPayload.name)}
                </Avatar>
                <Stack spacing={0.1}>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem' }}>
                    Автор: {selectedReportCharacterPayload.author_name || 'Неизвестный автор'}
                  </Typography>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                    {formatReportDate(selectedReportCharacterPayload.created_at)}
                  </Typography>
                </Stack>
              </Stack>

              <Typography sx={{ color: 'var(--morius-text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {selectedReportCharacterPayload.description || 'Описание не указано.'}
              </Typography>

              <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem' }}>
                Триггеры:{' '}
                {selectedReportCharacterPayload.triggers.length > 0
                  ? selectedReportCharacterPayload.triggers.join(', ')
                  : 'Не указаны'}
              </Typography>

              {selectedReport ? (
                <Box
                  sx={{
                    borderRadius: '10px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'rgba(22, 30, 40, 0.34)',
                    p: 1.1,
                  }}
                >
                  <Typography sx={{ fontWeight: 700, mb: 0.35 }}>Жалоба</Typography>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.86rem' }}>
                    Причина: {formatReportReasonLabel(selectedReport.latest_reason)}
                  </Typography>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.86rem', whiteSpace: 'pre-wrap' }}>
                    Описание: {selectedReport.latest_description || 'Без описания'}
                  </Typography>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.86rem' }}>
                    Жалоб: {selectedReport.open_reports_count}
                  </Typography>
                </Box>
              ) : null}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.3, pt: 0.6 }}>
          <Button onClick={handleCloseTargetDialog} disabled={isLoadingReportTarget || isApplyingReportAction} sx={{ color: 'text.secondary' }}>
            Закрыть
          </Button>
          <Button
            onClick={() => void handleDismissReport()}
            disabled={reportActionDisabled}
            sx={{
              borderRadius: 'var(--morius-radius)',
              border: 'var(--morius-border-width) solid rgba(188, 202, 221, 0.36)',
              color: 'var(--morius-text-primary)',
              backgroundColor: 'var(--morius-card-bg)',
              '&:hover': {
                backgroundColor: 'var(--morius-button-hover)',
              },
            }}
          >
            Отклонить жалобу
          </Button>
          <Button
            onClick={() => void handleRemoveReportedTarget()}
            disabled={reportActionDisabled}
            sx={{
              borderRadius: 'var(--morius-radius)',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              color: 'var(--morius-text-primary)',
              backgroundColor: 'rgba(192, 91, 91, 0.38)',
              '&:hover': {
                backgroundColor: 'rgba(199, 102, 102, 0.5)',
              },
            }}
          >
            {selectedReport ? formatRemoveActionLabel(selectedReport.target_type) : 'Удалить'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={open && isInstructionReportDialogOpen}
        onClose={handleCloseTargetDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 'var(--morius-radius)',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            color: 'var(--morius-text-primary)',
            boxShadow: '0 28px 70px rgba(0, 0, 0, 0.58)',
          },
        }}
        BackdropProps={{
          sx: {
            backgroundColor: 'rgba(2, 4, 8, 0.8)',
            backdropFilter: 'blur(5px)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 0.9 }}>
          {selectedReportInstructionPayload?.title || selectedReport?.target_title || 'Инструкция'}
        </DialogTitle>
        <DialogContent sx={{ pt: 0.4 }}>
          {isLoadingReportTarget || !selectedReportInstructionPayload ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 3 }}>
              <CircularProgress size={26} />
            </Stack>
          ) : (
            <Stack spacing={1.15}>
              <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem' }}>
                Автор: {selectedReportInstructionPayload.author_name || 'Неизвестный автор'}
              </Typography>
              <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                {formatReportDate(selectedReportInstructionPayload.created_at)}
              </Typography>

              <Typography sx={{ color: 'var(--morius-text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {selectedReportInstructionPayload.content || 'Содержимое отсутствует.'}
              </Typography>

              {selectedReport ? (
                <Box
                  sx={{
                    borderRadius: '10px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'rgba(22, 30, 40, 0.34)',
                    p: 1.1,
                  }}
                >
                  <Typography sx={{ fontWeight: 700, mb: 0.35 }}>Жалоба</Typography>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.86rem' }}>
                    Причина: {formatReportReasonLabel(selectedReport.latest_reason)}
                  </Typography>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.86rem', whiteSpace: 'pre-wrap' }}>
                    Описание: {selectedReport.latest_description || 'Без описания'}
                  </Typography>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.86rem' }}>
                    Жалоб: {selectedReport.open_reports_count}
                  </Typography>
                </Box>
              ) : null}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.3, pt: 0.6 }}>
          <Button onClick={handleCloseTargetDialog} disabled={isLoadingReportTarget || isApplyingReportAction} sx={{ color: 'text.secondary' }}>
            Закрыть
          </Button>
          <Button
            onClick={() => void handleDismissReport()}
            disabled={reportActionDisabled}
            sx={{
              borderRadius: 'var(--morius-radius)',
              border: 'var(--morius-border-width) solid rgba(188, 202, 221, 0.36)',
              color: 'var(--morius-text-primary)',
              backgroundColor: 'var(--morius-card-bg)',
              '&:hover': {
                backgroundColor: 'var(--morius-button-hover)',
              },
            }}
          >
            Отклонить жалобу
          </Button>
          <Button
            onClick={() => void handleRemoveReportedTarget()}
            disabled={reportActionDisabled}
            sx={{
              borderRadius: 'var(--morius-radius)',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              color: 'var(--morius-text-primary)',
              backgroundColor: 'rgba(192, 91, 91, 0.38)',
              '&:hover': {
                backgroundColor: 'rgba(199, 102, 102, 0.5)',
              },
            }}
          >
            {selectedReport ? formatRemoveActionLabel(selectedReport.target_type) : 'Удалить'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default AdminPanelDialog
export { ADMIN_PANEL_EMAIL_ALLOWLIST }

