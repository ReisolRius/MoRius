import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import mobileCloseIcon from '../../assets/icons/mobile-close.svg'
import CommunityWorldDialog from '../community/CommunityWorldDialog'
import useMobileDialogSheet from '../dialogs/useMobileDialogSheet'
import ProgressiveAvatar from '../media/ProgressiveAvatar'
import ProgressiveImage from '../media/ProgressiveImage'
import {
  approveModerationCharacterForAdmin,
  approveModerationInstructionTemplateForAdmin,
  approveModerationWorldForAdmin,
  type AdminModerationCharacterDetail,
  type AdminModerationInstructionTemplateDetail,
  type AdminModerationQueueItem,
  type AdminModerationWorldDetail,
  banUserAsAdmin,
  dismissCharacterReportsAsAdmin,
  dismissInstructionTemplateReportsAsAdmin,
  dismissWorldReportsAsAdmin,
  getModerationCharacterForAdmin,
  getModerationInstructionTemplateForAdmin,
  getModerationWorldForAdmin,
  listBugReportsForAdmin,
  listPendingModerationItemsForAdmin,
  listOpenReportsForAdmin,
  removeCharacterFromCommunityAsAdmin,
  removeInstructionTemplateFromCommunityAsAdmin,
  removeWorldFromCommunityAsAdmin,
  rejectModerationCharacterForAdmin,
  rejectModerationInstructionTemplateForAdmin,
  rejectModerationWorldForAdmin,
  searchUsersForAdminPanel,
  unbanUserAsAdmin,
  updateModeratorRoleAsAdmin,
  updateModerationCharacterForAdmin,
  updateModerationInstructionTemplateForAdmin,
  updateModerationWorldForAdmin,
  updateUserTokensAsAdmin,
  type AdminManagedUser,
  type AdminBugReportSummary,
  type AdminReport,
  type AdminReportReason,
  type AdminReportTargetType,
} from '../../services/authApi'
import { resolveApiResourceUrl } from '../../services/httpClient'
import {
  getCommunityCharacter,
  getCommunityInstructionTemplate,
  getCommunityWorld,
} from '../../services/storyApi'
import TextLimitIndicator from '../TextLimitIndicator'
import type {
  StoryCharacter,
  StoryCommunityCharacterSummary,
  StoryCommunityInstructionTemplateSummary,
  StoryCommunityWorldPayload,
  StoryGameSummary,
  StoryInstructionCard,
  StoryInstructionTemplate,
  StoryPlotCard,
  StoryWorldCard,
} from '../../types/story'

const ADMIN_PANEL_EMAIL_ALLOWLIST = new Set(['alexunderstood8@gmail.com', 'borisow.n2011@gmail.com'])
const ADMIN_SEARCH_QUERY_MAX_LENGTH = 120
const ADMIN_TOKEN_AMOUNT_MAX_LENGTH = 10
const ADMIN_BAN_DURATION_MAX_LENGTH = 5
const ADMIN_USER_PAGE_SIZE = 40

type AdminPanelTab = 'users' | 'reports' | 'moderation' | 'bug_reports'
type AdminUserSortMode = 'created_desc' | 'coins_desc' | 'coins_asc'

type ModerationWorldDraft = AdminModerationWorldDetail & {
  game: StoryGameSummary
  instruction_cards: StoryInstructionCard[]
  plot_cards: StoryPlotCard[]
  world_cards: StoryWorldCard[]
}

type ModerationCharacterDraft = AdminModerationCharacterDetail & {
  character: StoryCharacter
}

type ModerationInstructionDraft = AdminModerationInstructionTemplateDetail & {
  template: StoryInstructionTemplate
}

type AdminPanelDialogProps = {
  open: boolean
  authToken: string
  currentUserEmail: string
  currentUserRole: string
  onNavigate: (path: string) => void
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

function getBugReportDescriptionPreview(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'Без описания'
  }
  if (normalized.length <= 140) {
    return normalized
  }
  return `${normalized.slice(0, 137)}...`
}

function buildReportKey(report: AdminReport): string {
  return `${report.target_type}:${report.target_id}`
}

function buildModerationKey(item: Pick<AdminModerationQueueItem, 'target_type' | 'target_id'>): string {
  return `${item.target_type}:${item.target_id}`
}

function normalizeModerationStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildModerationWorldDraft(detail: AdminModerationWorldDetail): ModerationWorldDraft {
  return {
    ...detail,
    game: {
      ...detail.game,
      genres: normalizeModerationStringArray(detail.game?.genres),
    },
    instruction_cards: Array.isArray(detail.instruction_cards) ? detail.instruction_cards.map((card) => ({ ...card })) : [],
    plot_cards: Array.isArray(detail.plot_cards)
      ? detail.plot_cards.map((card) => ({ ...card, triggers: normalizeModerationStringArray(card.triggers) }))
      : [],
    world_cards: Array.isArray(detail.world_cards)
      ? detail.world_cards.map((card) => ({ ...card, triggers: normalizeModerationStringArray(card.triggers) }))
      : [],
  }
}

function buildModerationCharacterDraft(detail: AdminModerationCharacterDetail): ModerationCharacterDraft {
  return {
    ...detail,
    character: {
      ...detail.character,
      triggers: normalizeModerationStringArray(detail.character?.triggers),
    },
  }
}

function normalizeModerationQueueItem(item: AdminModerationQueueItem): AdminModerationQueueItem {
  const authorEmail = typeof item.author?.email === 'string' ? item.author.email.trim() : ''
  const authorDisplayName = typeof item.author?.display_name === 'string' ? item.author.display_name.trim() : ''
  const status = item.publication?.status
  return {
    ...item,
    target_id: Number.isFinite(item.target_id) ? Math.trunc(item.target_id) : 0,
    target_title: typeof item.target_title === 'string' && item.target_title.trim() ? item.target_title.trim() : 'Материал на модерации',
    target_description: typeof item.target_description === 'string' ? item.target_description : '',
    target_preview_image_url:
      typeof item.target_preview_image_url === 'string' && item.target_preview_image_url.trim() ? item.target_preview_image_url : null,
    author: {
      id: Number.isFinite(item.author?.id) ? Math.trunc(item.author.id) : 0,
      email: authorEmail,
      display_name: authorDisplayName || authorEmail || 'Неизвестный автор',
      avatar_url: typeof item.author?.avatar_url === 'string' && item.author.avatar_url.trim() ? item.author.avatar_url : null,
      role: typeof item.author?.role === 'string' && item.author.role.trim() ? item.author.role : 'user',
    },
    publication: {
      status: status === 'pending' || status === 'approved' || status === 'rejected' ? status : 'none',
      requested_at: typeof item.publication?.requested_at === 'string' ? item.publication.requested_at : null,
      reviewed_at: typeof item.publication?.reviewed_at === 'string' ? item.publication.reviewed_at : null,
      reviewer_user_id:
        typeof item.publication?.reviewer_user_id === 'number' && Number.isFinite(item.publication.reviewer_user_id)
          ? Math.trunc(item.publication.reviewer_user_id)
          : null,
      rejection_reason:
        typeof item.publication?.rejection_reason === 'string' && item.publication.rejection_reason.trim()
          ? item.publication.rejection_reason
          : null,
    },
    created_at: typeof item.created_at === 'string' ? item.created_at : new Date(0).toISOString(),
    updated_at: typeof item.updated_at === 'string' ? item.updated_at : new Date(0).toISOString(),
  }
}

function AdminPanelDialog({ open, authToken, currentUserEmail, currentUserRole, onNavigate, onClose }: AdminPanelDialogProps) {
  const [activeTab, setActiveTab] = useState<AdminPanelTab>('users')
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminManagedUser[]>([])
  const [userSortMode, setUserSortMode] = useState<AdminUserSortMode>('created_desc')
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [tokenAmountDraft, setTokenAmountDraft] = useState('100')
  const [banDurationDraft, setBanDurationDraft] = useState('24')
  const [banDurationUnit, setBanDurationUnit] = useState<'hours' | 'days'>('hours')
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [hasMoreUsers, setHasMoreUsers] = useState(false)
  const [usersTotalCount, setUsersTotalCount] = useState(0)
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
  const [bugReports, setBugReports] = useState<AdminBugReportSummary[]>([])
  const [selectedBugReportId, setSelectedBugReportId] = useState<number | null>(null)
  const [isLoadingBugReports, setIsLoadingBugReports] = useState(false)
  const [isBugReportDialogOpen, setIsBugReportDialogOpen] = useState(false)
  const [moderationItems, setModerationItems] = useState<AdminModerationQueueItem[]>([])
  const [selectedModerationKey, setSelectedModerationKey] = useState<string | null>(null)
  const [isLoadingModerationQueue, setIsLoadingModerationQueue] = useState(false)
  const [isLoadingModerationDetail, setIsLoadingModerationDetail] = useState(false)
  const [isApplyingModerationAction, setIsApplyingModerationAction] = useState(false)
  const [moderationWorldDraft, setModerationWorldDraft] = useState<ModerationWorldDraft | null>(null)
  const [moderationCharacterDraft, setModerationCharacterDraft] = useState<ModerationCharacterDraft | null>(null)
  const [moderationInstructionDraft, setModerationInstructionDraft] = useState<ModerationInstructionDraft | null>(null)
  const [moderationCommentDraft, setModerationCommentDraft] = useState('')

  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const canUseAdminPanel = useMemo(
    () => ADMIN_PANEL_EMAIL_ALLOWLIST.has(currentUserEmail.trim().toLowerCase()),
    [currentUserEmail],
  )
  const canManageModeratorRole = useMemo(
    () => currentUserRole.trim().toLowerCase() === 'administrator',
    [currentUserRole],
  )

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  )
  const usersListContainerRef = useRef<HTMLDivElement | null>(null)
  const usersRequestInFlightRef = useRef(false)
  const moderationDetailRequestIdRef = useRef(0)

  const selectedReport = useMemo(
    () => reports.find((report) => buildReportKey(report) === selectedReportKey) ?? null,
    [reports, selectedReportKey],
  )

  const selectedBugReport = useMemo(
    () => bugReports.find((report) => report.id === selectedBugReportId) ?? null,
    [bugReports, selectedBugReportId],
  )

  const selectedModerationItem = useMemo(
    () => moderationItems.find((item) => buildModerationKey(item) === selectedModerationKey) ?? null,
    [moderationItems, selectedModerationKey],
  )

  const resetSelectedReportTargetPayloads = useCallback(() => {
    setSelectedReportWorldPayload(null)
    setSelectedReportCharacterPayload(null)
    setSelectedReportInstructionPayload(null)
  }, [])

  const resetModerationDrafts = useCallback(() => {
    setModerationWorldDraft(null)
    setModerationCharacterDraft(null)
    setModerationInstructionDraft(null)
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
    async (searchValue: string, options?: { append?: boolean; offset?: number }) => {
      if (!open || !canUseAdminPanel) {
        return
      }
      const append = options?.append ?? false
      const offset = append ? Math.max(0, Math.trunc(options?.offset ?? 0)) : 0
      if (usersRequestInFlightRef.current) {
        return
      }
      usersRequestInFlightRef.current = true
      setIsLoadingUsers(true)
      setErrorMessage('')
      try {
        const response = await searchUsersForAdminPanel({
          token: authToken,
          query: searchValue,
          limit: ADMIN_USER_PAGE_SIZE,
          offset,
          sort: userSortMode,
        })
        const nextUsers = response.users
        setUsers((previous) => {
          if (!append) {
            return nextUsers
          }
          const nextById = new Map<number, AdminManagedUser>()
          previous.forEach((user) => nextById.set(user.id, user))
          nextUsers.forEach((user) => nextById.set(user.id, user))
          return Array.from(nextById.values())
        })
        setUsersTotalCount(response.total_count)
        setHasMoreUsers(response.has_more)
        if (!append && nextUsers.length === 0) {
          setSelectedUserId(null)
          return
        }
        if (!append) {
          setSelectedUserId((previous) =>
            previous && nextUsers.some((user) => user.id === previous) ? previous : (nextUsers[0]?.id ?? null),
          )
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось загрузить пользователей'
        setErrorMessage(detail)
        if (!append) {
          setUsers([])
          setUsersTotalCount(0)
          setHasMoreUsers(false)
          setSelectedUserId(null)
        }
      } finally {
        usersRequestInFlightRef.current = false
        setIsLoadingUsers(false)
      }
    },
    [authToken, canUseAdminPanel, open, userSortMode],
  )

  const handleUsersListScroll = useCallback(() => {
    const container = usersListContainerRef.current
    if (!container || activeTab !== 'users' || !hasMoreUsers || isLoadingUsers) {
      return
    }
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (distanceToBottom <= 120) {
      void loadUsers(query, { append: true, offset: users.length })
    }
  }, [activeTab, hasMoreUsers, isLoadingUsers, loadUsers, query, users.length])

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

  const loadBugReports = useCallback(async () => {
    if (!open || !canUseAdminPanel) {
      return
    }
    setIsLoadingBugReports(true)
    setErrorMessage('')
    try {
      const response = await listBugReportsForAdmin({
        token: authToken,
      })
      setBugReports(response)
      setSelectedBugReportId((previous) => {
        if (previous && response.some((report) => report.id === previous)) {
          return previous
        }
        return response[0]?.id ?? null
      })
      if (response.length === 0) {
        setIsBugReportDialogOpen(false)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить баг-репорты'
      setErrorMessage(detail)
      setBugReports([])
      setSelectedBugReportId(null)
      setIsBugReportDialogOpen(false)
    } finally {
      setIsLoadingBugReports(false)
    }
  }, [authToken, canUseAdminPanel, open])

  const loadModerationQueue = useCallback(async () => {
    if (!open || !canUseAdminPanel) {
      return
    }
    setIsLoadingModerationQueue(true)
    setErrorMessage('')
    try {
      const response = await listPendingModerationItemsForAdmin({
        token: authToken,
      })
      const items = (response.items ?? []).map((item) => normalizeModerationQueueItem(item)).filter((item) => item.target_id > 0)
      setModerationItems(items)
      setSelectedModerationKey((previous) => {
        if (previous && items.some((item) => buildModerationKey(item) === previous)) {
          return previous
        }
        return items[0] ? buildModerationKey(items[0]) : null
      })
      if (items.length === 0) {
        resetModerationDrafts()
        setModerationCommentDraft('')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить очередь модерации'
      setErrorMessage(detail)
      setModerationItems([])
      setSelectedModerationKey(null)
      resetModerationDrafts()
    } finally {
      setIsLoadingModerationQueue(false)
    }
  }, [authToken, canUseAdminPanel, open, resetModerationDrafts])

  const openModerationItem = useCallback(
    async (item: AdminModerationQueueItem) => {
      if (isApplyingModerationAction) {
        return
      }
      const requestId = moderationDetailRequestIdRef.current + 1
      moderationDetailRequestIdRef.current = requestId
      resetModerationDrafts()
      setModerationCommentDraft(item.publication.rejection_reason?.trim() ?? '')
      setIsLoadingModerationDetail(true)
      setErrorMessage('')
      try {
        if (item.target_type === 'world') {
          const detail = await getModerationWorldForAdmin({
            token: authToken,
            world_id: item.target_id,
          })
          if (requestId !== moderationDetailRequestIdRef.current) {
            return
          }
          setModerationWorldDraft(buildModerationWorldDraft(detail))
          return
        }
        if (item.target_type === 'character') {
          const detail = await getModerationCharacterForAdmin({
            token: authToken,
            character_id: item.target_id,
          })
          if (requestId !== moderationDetailRequestIdRef.current) {
            return
          }
          setModerationCharacterDraft(buildModerationCharacterDraft(detail))
          return
        }
        const detail = await getModerationInstructionTemplateForAdmin({
          token: authToken,
          template_id: item.target_id,
        })
        if (requestId !== moderationDetailRequestIdRef.current) {
          return
        }
        setModerationInstructionDraft({
          ...detail,
          template: { ...detail.template },
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось открыть отправленный материал'
        if (requestId === moderationDetailRequestIdRef.current) {
          setErrorMessage(detail)
          resetModerationDrafts()
        }
      } finally {
        if (requestId === moderationDetailRequestIdRef.current) {
          setIsLoadingModerationDetail(false)
        }
      }
    },
    [authToken, isApplyingModerationAction, resetModerationDrafts],
  )

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
    if (activeTab === 'reports') {
      void loadReports()
      return
    }
    if (activeTab === 'moderation') {
      void loadModerationQueue()
      return
    }
    void loadBugReports()
  }, [activeTab, loadBugReports, loadModerationQueue, loadReports, loadUsers, open, query, userSortMode])

  useEffect(() => {
    handleUsersListScroll()
  }, [handleUsersListScroll, users.length])

  useEffect(() => {
    if (!open || activeTab !== 'moderation' || !selectedModerationItem || isLoadingModerationDetail) {
      return
    }
    if (buildModerationKey(selectedModerationItem) !== selectedModerationKey) {
      return
    }
    void openModerationItem(selectedModerationItem)
  }, [activeTab, open, openModerationItem, selectedModerationItem, selectedModerationKey])

  useEffect(() => {
    if (!open) {
      resetSelectedReportTargetPayloads()
      return
    }
    setActiveTab('users')
    setQuery('')
    setUserSortMode('created_desc')
    setUsers([])
    setUsersTotalCount(0)
    setHasMoreUsers(false)
    setSelectedUserId(null)
    setTokenAmountDraft('100')
    setBanDurationDraft('24')
    setBanDurationUnit('hours')
    setReports([])
    setSelectedReportKey(null)
    resetSelectedReportTargetPayloads()
    setBugReports([])
    setSelectedBugReportId(null)
    setIsBugReportDialogOpen(false)
    setModerationItems([])
    setSelectedModerationKey(null)
    setModerationCommentDraft('')
    resetModerationDrafts()
    setErrorMessage('')
    setSuccessMessage('')
    usersRequestInFlightRef.current = false
    moderationDetailRequestIdRef.current = 0
  }, [open, resetModerationDrafts, resetSelectedReportTargetPayloads])

  const handleSelectModerationItem = useCallback(
    (item: AdminModerationQueueItem) => {
      setSelectedModerationKey(buildModerationKey(item))
      void openModerationItem(item)
    },
    [openModerationItem],
  )

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

  const handleUpdateModeratorRole = useCallback(async (isModerator: boolean) => {
    if (!selectedUser) {
      setErrorMessage('Выберите пользователя')
      return
    }

    setIsApplyingUserAction(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const updatedUser = await updateModeratorRoleAsAdmin({
        token: authToken,
        user_id: selectedUser.id,
        is_moderator: isModerator,
      })
      mergeUpdatedUser(updatedUser)
      setSuccessMessage(isModerator ? 'Модератор выдан' : 'Модератор снят')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось изменить роль модератора'
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

  const handleOpenBugReportDialog = useCallback((reportId: number) => {
    setSelectedBugReportId(reportId)
    setIsBugReportDialogOpen(true)
  }, [])

  const handleCloseBugReportDialog = useCallback(() => {
    setIsBugReportDialogOpen(false)
  }, [])

  const handleGoToBugReportSnapshot = useCallback(() => {
    if (!selectedBugReport) {
      return
    }
    setIsBugReportDialogOpen(false)
    onClose()
    onNavigate(`/home/reports/${selectedBugReport.id}`)
  }, [onClose, onNavigate, selectedBugReport])

  const handleModerationWorldFieldChange = useCallback((field: keyof StoryGameSummary, value: unknown) => {
    setModerationWorldDraft((previous) => (previous ? { ...previous, game: { ...previous.game, [field]: value } } : previous))
  }, [])

  const handleModerationWorldInstructionCardChange = useCallback(
    (cardId: number, patch: Partial<StoryInstructionCard>) => {
      setModerationWorldDraft((previous) =>
        previous
          ? {
              ...previous,
              instruction_cards: previous.instruction_cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
            }
          : previous,
      )
    },
    [],
  )

  const handleModerationWorldPlotCardChange = useCallback((cardId: number, patch: Partial<StoryPlotCard>) => {
    setModerationWorldDraft((previous) =>
      previous
        ? {
            ...previous,
            plot_cards: previous.plot_cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
          }
        : previous,
    )
  }, [])

  const handleModerationWorldCardChange = useCallback((cardId: number, patch: Partial<StoryWorldCard>) => {
    setModerationWorldDraft((previous) =>
      previous
        ? {
            ...previous,
            world_cards: previous.world_cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
          }
        : previous,
    )
  }, [])

  const handleModerationCharacterFieldChange = useCallback((field: keyof StoryCharacter, value: unknown) => {
    setModerationCharacterDraft((previous) =>
      previous ? { ...previous, character: { ...previous.character, [field]: value } } : previous,
    )
  }, [])

  const handleModerationInstructionFieldChange = useCallback((field: keyof StoryInstructionTemplate, value: unknown) => {
    setModerationInstructionDraft((previous) =>
      previous ? { ...previous, template: { ...previous.template, [field]: value } } : previous,
    )
  }, [])

  const handleSaveModerationDraft = useCallback(async () => {
    if (!selectedModerationItem || isApplyingModerationAction || isLoadingModerationDetail) {
      return
    }
    setIsApplyingModerationAction(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      if (selectedModerationItem.target_type === 'world' && moderationWorldDraft) {
        const updated = await updateModerationWorldForAdmin({
          token: authToken,
          world_id: moderationWorldDraft.game.id,
          title: moderationWorldDraft.game.title,
          description: moderationWorldDraft.game.description,
          opening_scene: moderationWorldDraft.game.opening_scene,
          age_rating: moderationWorldDraft.game.age_rating,
          genres: moderationWorldDraft.game.genres,
          cover_image_url: moderationWorldDraft.game.cover_image_url,
          cover_scale: moderationWorldDraft.game.cover_scale,
          cover_position_x: moderationWorldDraft.game.cover_position_x,
          cover_position_y: moderationWorldDraft.game.cover_position_y,
          instruction_cards: moderationWorldDraft.instruction_cards.map((card) => ({
            id: card.id,
            title: card.title,
            content: card.content,
            is_active: card.is_active,
          })),
          plot_cards: moderationWorldDraft.plot_cards.map((card) => ({
            id: card.id,
            title: card.title,
            content: card.content,
            triggers: card.triggers,
            memory_turns: card.memory_turns,
            is_enabled: card.is_enabled,
          })),
          world_cards: moderationWorldDraft.world_cards.map((card) => ({
            id: card.id,
            title: card.title,
            content: card.content,
            triggers: card.triggers,
            avatar_url: card.avatar_url,
            avatar_original_url: card.avatar_original_url ?? null,
            avatar_scale: card.avatar_scale,
            memory_turns: card.memory_turns,
          })),
        })
        setModerationWorldDraft(buildModerationWorldDraft(updated))
        setSuccessMessage('Изменения мира сохранены')
      } else if (selectedModerationItem.target_type === 'character' && moderationCharacterDraft) {
        const updated = await updateModerationCharacterForAdmin({
          token: authToken,
          character_id: moderationCharacterDraft.character.id,
          name: moderationCharacterDraft.character.name,
          description: moderationCharacterDraft.character.description,
          note: moderationCharacterDraft.character.note,
          triggers: moderationCharacterDraft.character.triggers,
          avatar_url: moderationCharacterDraft.character.avatar_url,
          avatar_original_url: moderationCharacterDraft.character.avatar_original_url ?? null,
          avatar_scale: moderationCharacterDraft.character.avatar_scale,
        })
        setModerationCharacterDraft(buildModerationCharacterDraft(updated))
        setSuccessMessage('Изменения персонажа сохранены')
      } else if (selectedModerationItem.target_type === 'instruction_template' && moderationInstructionDraft) {
        const updated = await updateModerationInstructionTemplateForAdmin({
          token: authToken,
          template_id: moderationInstructionDraft.template.id,
          title: moderationInstructionDraft.template.title,
          content: moderationInstructionDraft.template.content,
        })
        setModerationInstructionDraft({
          ...updated,
          template: { ...updated.template },
        })
        setSuccessMessage('Изменения инструкции сохранены')
      }
      await loadModerationQueue()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить правки модерации'
      setErrorMessage(detail)
    } finally {
      setIsApplyingModerationAction(false)
    }
  }, [
    authToken,
    isApplyingModerationAction,
    isLoadingModerationDetail,
    loadModerationQueue,
    moderationCharacterDraft,
    moderationInstructionDraft,
    moderationWorldDraft,
    selectedModerationItem,
  ])

  const handleApproveModerationItem = useCallback(async () => {
    if (!selectedModerationItem || isApplyingModerationAction || isLoadingModerationDetail) {
      return
    }
    setIsApplyingModerationAction(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      if (selectedModerationItem.target_type === 'world') {
        await approveModerationWorldForAdmin({
          token: authToken,
          world_id: selectedModerationItem.target_id,
        })
      } else if (selectedModerationItem.target_type === 'character') {
        await approveModerationCharacterForAdmin({
          token: authToken,
          character_id: selectedModerationItem.target_id,
        })
      } else {
        await approveModerationInstructionTemplateForAdmin({
          token: authToken,
          template_id: selectedModerationItem.target_id,
        })
      }
      setSuccessMessage('Материал одобрен и отправлен в сообщество')
      resetModerationDrafts()
      setModerationCommentDraft('')
      await loadModerationQueue()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось одобрить материал'
      setErrorMessage(detail)
    } finally {
      setIsApplyingModerationAction(false)
    }
  }, [authToken, isApplyingModerationAction, isLoadingModerationDetail, loadModerationQueue, resetModerationDrafts, selectedModerationItem])

  const handleRejectModerationItem = useCallback(async () => {
    if (!selectedModerationItem || isApplyingModerationAction || isLoadingModerationDetail) {
      return
    }
    const rejectionReason = moderationCommentDraft.trim()
    if (!rejectionReason) {
      setErrorMessage('Добавьте комментарий модератора перед отклонением')
      return
    }
    setIsApplyingModerationAction(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      if (selectedModerationItem.target_type === 'world') {
        await rejectModerationWorldForAdmin({
          token: authToken,
          world_id: selectedModerationItem.target_id,
          rejection_reason: rejectionReason,
        })
      } else if (selectedModerationItem.target_type === 'character') {
        await rejectModerationCharacterForAdmin({
          token: authToken,
          character_id: selectedModerationItem.target_id,
          rejection_reason: rejectionReason,
        })
      } else {
        await rejectModerationInstructionTemplateForAdmin({
          token: authToken,
          template_id: selectedModerationItem.target_id,
          rejection_reason: rejectionReason,
        })
      }
      setSuccessMessage('Материал отклонён с комментарием')
      resetModerationDrafts()
      setModerationCommentDraft('')
      await loadModerationQueue()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось отклонить материал'
      setErrorMessage(detail)
    } finally {
      setIsApplyingModerationAction(false)
    }
  }, [
    authToken,
    isApplyingModerationAction,
    isLoadingModerationDetail,
    loadModerationQueue,
    moderationCommentDraft,
    resetModerationDrafts,
    selectedModerationItem,
  ])

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

  const moderationActionDisabled =
    !selectedModerationItem || isLoadingModerationDetail || isApplyingModerationAction
  const adminPanelSheet = useMobileDialogSheet({ onClose })
  const bugReportSheet = useMobileDialogSheet({ onClose: handleCloseBugReportDialog })
  const characterReportSheet = useMobileDialogSheet({ onClose: handleCloseTargetDialog, disabled: reportActionDisabled })
  const instructionReportSheet = useMobileDialogSheet({ onClose: handleCloseTargetDialog, disabled: reportActionDisabled })

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth={false}
        fullWidth={false}
        sx={adminPanelSheet.dialogSx}
        PaperProps={{
          ...adminPanelSheet.paperTouchHandlers,
          sx: {
            width: 'min(98vw, 1560px)',
            maxWidth: 'none',
            height: 'min(96vh, 1080px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: 'var(--morius-radius)',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            boxShadow: '0 28px 70px rgba(0, 0, 0, 0.58)',
            ...adminPanelSheet.paperSx,
          },
        }}
        BackdropProps={{
          sx: {
            ...adminPanelSheet.backdropSx,
            backgroundColor: 'rgba(2, 4, 8, 0.8)',
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
              color: 'var(--morius-text-secondary)',
              backgroundColor: 'transparent',
              '&:hover': {
                backgroundColor: 'transparent',
                color: 'var(--morius-title-text)',
              },
            }}
          >
            <Box component="img" src={mobileCloseIcon} alt="" sx={{ width: 18, height: 18, display: 'block', opacity: 0.84 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent
          sx={{
            pt: 0.5,
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
            {!canUseAdminPanel ? <Alert severity="error">Доступ к админ-панели запрещен для этого аккаунта</Alert> : null}
            {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
            {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}

            <Stack direction="row" spacing={1}>
              <Button
                variant={activeTab === 'users' ? 'contained' : 'outlined'}
                onClick={() => setActiveTab('users')}
                disabled={!canUseAdminPanel || isApplyingUserAction || isApplyingReportAction || isApplyingModerationAction}
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
                disabled={!canUseAdminPanel || isApplyingUserAction || isApplyingReportAction || isApplyingModerationAction}
                sx={{
                  textTransform: 'none',
                  borderRadius: 'var(--morius-radius)',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                }}
              >
                Жалобы
              </Button>
              <Button
                variant={activeTab === 'moderation' ? 'contained' : 'outlined'}
                onClick={() => setActiveTab('moderation')}
                disabled={!canUseAdminPanel || isApplyingUserAction || isApplyingReportAction || isApplyingModerationAction}
                sx={{
                  textTransform: 'none',
                  borderRadius: 'var(--morius-radius)',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                }}
              >
                Модерация
              </Button>
              <Button
                variant={activeTab === 'bug_reports' ? 'contained' : 'outlined'}
                onClick={() => setActiveTab('bug_reports')}
                disabled={!canUseAdminPanel || isApplyingUserAction || isApplyingReportAction || isApplyingModerationAction}
                sx={{
                  textTransform: 'none',
                  borderRadius: 'var(--morius-radius)',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                }}
              >
                Reports
              </Button>
            </Stack>

            {activeTab === 'users' ? (
              <Stack spacing={1.2} sx={{ flex: 1, minHeight: 0 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                  <TextField
                    value={query}
                    onChange={(event) => setQuery(event.target.value.slice(0, ADMIN_SEARCH_QUERY_MAX_LENGTH))}
                    placeholder="Введите email или ник"
                    size="small"
                    disabled={!canUseAdminPanel || isApplyingUserAction}
                    inputProps={{ maxLength: ADMIN_SEARCH_QUERY_MAX_LENGTH }}
                    helperText={<TextLimitIndicator currentLength={query.length} maxLength={ADMIN_SEARCH_QUERY_MAX_LENGTH} />}
                    FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    select
                    size="small"
                    label="Сортировка"
                    value={userSortMode}
                    onChange={(event) => setUserSortMode(event.target.value as AdminUserSortMode)}
                    disabled={!canUseAdminPanel || isApplyingUserAction}
                    sx={{ width: { xs: '100%', md: 260 }, flexShrink: 0 }}
                  >
                    <MenuItem value="created_desc">Новые сначала</MenuItem>
                    <MenuItem value="coins_desc">По солам: сначала больше</MenuItem>
                    <MenuItem value="coins_asc">По солам: сначала меньше</MenuItem>
                  </TextField>
                </Stack>

                <Box
                  ref={usersListContainerRef}
                  className="morius-scrollbar"
                  onScroll={handleUsersListScroll}
                  sx={{
                    borderRadius: '12px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-card-bg)',
                    flex: 1,
                    minHeight: { xs: 360, lg: 520 },
                    overflowY: 'auto',
                    p: 0.8,
                  }}
                >
                  {isLoadingUsers && users.length === 0 ? (
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
                      {isLoadingUsers ? (
                        <Stack alignItems="center" justifyContent="center" sx={{ py: 0.8 }}>
                          <CircularProgress size={18} />
                        </Stack>
                      ) : null}
                    </Stack>
                  )}
                </Box>
                <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }}>
                  Показано пользователей: {users.length} из {usersTotalCount}
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    value={tokenAmountDraft}
                    onChange={(event) =>
                      setTokenAmountDraft(event.target.value.replace(/[^\d]/g, '').slice(0, ADMIN_TOKEN_AMOUNT_MAX_LENGTH))
                    }
                    label="Сумма солов"
                    size="small"
                    disabled={!selectedUser || isApplyingUserAction || !canUseAdminPanel}
                    inputProps={{ inputMode: 'numeric', maxLength: ADMIN_TOKEN_AMOUNT_MAX_LENGTH }}
                    helperText={<TextLimitIndicator currentLength={tokenAmountDraft.length} maxLength={ADMIN_TOKEN_AMOUNT_MAX_LENGTH} />}
                    FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
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
                      color: '#ffffff',
                    }}
                  >
                    Выдать
                  </Button>
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button
                    variant="outlined"
                    onClick={() => void handleUpdateModeratorRole(false)}
                    disabled={!selectedUser || isApplyingUserAction || !canUseAdminPanel || !canManageModeratorRole}
                    sx={{
                      minHeight: 40,
                      borderColor: 'rgba(188, 202, 221, 0.36)',
                      color: 'var(--morius-text-primary)',
                    }}
                  >
                    Снять модератора
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => void handleUpdateModeratorRole(true)}
                    disabled={!selectedUser || isApplyingUserAction || !canUseAdminPanel || !canManageModeratorRole}
                    sx={{
                      minHeight: 40,
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'rgba(89, 118, 191, 0.34)',
                      color: '#ffffff',
                      '&:hover': {
                        backgroundColor: 'rgba(104, 135, 212, 0.44)',
                      },
                    }}
                  >
                    Выдать модератора
                  </Button>
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    value={banDurationDraft}
                    onChange={(event) =>
                      setBanDurationDraft(event.target.value.replace(/[^\d]/g, '').slice(0, ADMIN_BAN_DURATION_MAX_LENGTH))
                    }
                    label="Длительность"
                    size="small"
                    disabled={!selectedUser || isApplyingUserAction || !canUseAdminPanel}
                    inputProps={{ inputMode: 'numeric', maxLength: ADMIN_BAN_DURATION_MAX_LENGTH }}
                    helperText={<TextLimitIndicator currentLength={banDurationDraft.length} maxLength={ADMIN_BAN_DURATION_MAX_LENGTH} />}
                    FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
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
            ) : activeTab === 'reports' ? (
              <Stack spacing={1.2} sx={{ flex: 1, minHeight: 0 }}>
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
            ) : activeTab === 'moderation' ? (
              <Stack spacing={1.2} sx={{ flex: 1, minHeight: 0 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.86rem' }}>Очередь модерации</Typography>
                  <Button
                    variant="outlined"
                    onClick={() => void loadModerationQueue()}
                    disabled={!canUseAdminPanel || isLoadingModerationQueue || isApplyingModerationAction}
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

                <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.2} alignItems="stretch" sx={{ flex: 1, minHeight: 0 }}>
                  <Box
                    className="morius-scrollbar"
                    sx={{
                      borderRadius: '12px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-card-bg)',
                      width: { xs: '100%', lg: 320 },
                      maxHeight: { xs: 260, lg: '100%' },
                      overflowY: 'auto',
                      p: 0.8,
                      flexShrink: 0,
                      minHeight: 0,
                    }}
                  >
                    {isLoadingModerationQueue ? (
                      <Stack alignItems="center" justifyContent="center" sx={{ py: 2.2 }}>
                        <CircularProgress size={24} />
                      </Stack>
                    ) : moderationItems.length === 0 ? (
                      <Typography sx={{ color: 'text.secondary', px: 0.8, py: 1 }}>Нет материалов на модерации</Typography>
                    ) : (
                      <Stack spacing={0.8}>
                        {moderationItems.map((item) => {
                          const isSelected = buildModerationKey(item) === selectedModerationKey
                          const requestedAt = item.publication.requested_at || item.updated_at
                          const authorLabel = item.author.display_name || item.author.email
                          return (
                            <Button
                              key={buildModerationKey(item)}
                              onClick={() => handleSelectModerationItem(item)}
                              disabled={isApplyingModerationAction}
                              sx={{
                                justifyContent: 'flex-start',
                                textTransform: 'none',
                                borderRadius: '10px',
                                border: 'var(--morius-border-width) solid',
                                borderColor: isSelected ? 'rgba(219, 230, 245, 0.52)' : 'rgba(184, 199, 214, 0.2)',
                                backgroundColor: isSelected ? 'rgba(37, 52, 70, 0.4)' : 'rgba(22, 30, 40, 0.34)',
                                color: 'var(--morius-text-primary)',
                                px: 1.1,
                                py: 1,
                                '&:hover': {
                                  backgroundColor: 'rgba(46, 62, 82, 0.42)',
                                },
                              }}
                            >
                              <Stack spacing={0.35} sx={{ width: '100%', alignItems: 'flex-start', minWidth: 0 }}>
                                <Typography sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
                                  {item.target_title}
                                </Typography>
                                <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }} noWrap>
                                  {formatReportTargetLabel(item.target_type)} · {authorLabel}
                                </Typography>
                                <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }} noWrap>
                                  {formatReportDate(requestedAt)}
                                </Typography>
                                <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem', textAlign: 'left' }}>
                                  {getReportDescriptionPreview(item.target_description)}
                                </Typography>
                              </Stack>
                            </Button>
                          )
                        })}
                      </Stack>
                    )}
                  </Box>

                  <Box
                    className="morius-scrollbar"
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      maxHeight: { xs: 560, lg: '100%' },
                      overflowY: 'auto',
                      borderRadius: '12px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-card-bg)',
                      p: 1.2,
                      '& .MuiFormLabel-root': {
                        color: 'rgba(189, 201, 216, 0.82)',
                      },
                      '& .MuiFormLabel-root.Mui-focused': {
                        color: 'var(--morius-text-primary)',
                      },
                      '& .MuiOutlinedInput-root': {
                        borderRadius: '10px',
                        color: 'var(--morius-text-primary)',
                        backgroundColor: 'rgba(18, 25, 35, 0.64)',
                      },
                      '& .MuiOutlinedInput-root fieldset': {
                        borderColor: 'rgba(184, 199, 214, 0.28)',
                      },
                      '& .MuiOutlinedInput-root:hover fieldset': {
                        borderColor: 'rgba(205, 218, 233, 0.42)',
                      },
                      '& .MuiOutlinedInput-root.Mui-focused fieldset': {
                        borderColor: 'rgba(211, 223, 239, 0.54)',
                      },
                      '& .MuiInputBase-input': {
                        color: 'var(--morius-text-primary)',
                      },
                      '& .MuiInputBase-input.Mui-disabled': {
                        WebkitTextFillColor: 'rgba(224, 232, 242, 0.72)',
                      },
                      '& .MuiInputBase-input::placeholder': {
                        color: 'rgba(177, 191, 208, 0.72)',
                        opacity: 1,
                      },
                    }}
                  >
                    {!selectedModerationItem ? (
                      <Typography sx={{ color: 'text.secondary' }}>Выберите материал слева, чтобы открыть его в модерации.</Typography>
                    ) : isLoadingModerationDetail ? (
                      <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
                        <CircularProgress size={28} />
                      </Stack>
                    ) : (
                      <Stack spacing={1.2}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                          {selectedModerationItem.target_preview_image_url ? (
                            <ProgressiveImage
                              src={resolveApiResourceUrl(selectedModerationItem.target_preview_image_url) || undefined}
                              alt=""
                              loading="lazy"
                              fetchPriority="low"
                              objectFit="cover"
                              loaderSize={24}
                              containerSx={{
                                width: { xs: '100%', sm: 164 },
                                height: { xs: 164, sm: 102 },
                                borderRadius: '10px',
                                border: 'var(--morius-border-width) solid rgba(184, 199, 214, 0.22)',
                                backgroundColor: 'rgba(18, 25, 35, 0.4)',
                              }}
                            />
                          ) : null}
                          <Stack spacing={0.45} sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', lineHeight: 1.15 }}>
                              {selectedModerationItem.target_title}
                            </Typography>
                            <Stack direction="row" spacing={0.8} alignItems="center">
                              <ProgressiveAvatar
                                src={resolveApiResourceUrl(selectedModerationItem.author.avatar_url) || undefined}
                                alt={selectedModerationItem.author.display_name}
                                fallbackLabel={selectedModerationItem.author.display_name || selectedModerationItem.author.email}
                                size={34}
                              />
                              <Stack spacing={0.1}>
                                <Typography sx={{ fontSize: '0.85rem', fontWeight: 700 }}>
                                  {selectedModerationItem.author.display_name || selectedModerationItem.author.email}
                                </Typography>
                                <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }}>
                                  {formatReportTargetLabel(selectedModerationItem.target_type)} · {formatReportDate(selectedModerationItem.publication.requested_at || selectedModerationItem.updated_at)}
                                </Typography>
                              </Stack>
                            </Stack>
                          </Stack>
                        </Stack>

                        {moderationWorldDraft ? (
                          <Stack spacing={1.05}>
                            <TextField
                              label="Название мира"
                              value={moderationWorldDraft.game.title}
                              onChange={(event) => handleModerationWorldFieldChange('title', event.target.value)}
                              size="small"
                            />
                            <TextField
                              label="Жанры через запятую"
                              value={moderationWorldDraft.game.genres.join(', ')}
                              onChange={(event) =>
                                handleModerationWorldFieldChange(
                                  'genres',
                                  event.target.value
                                    .split(',')
                                    .map((item) => item.trim())
                                    .filter(Boolean),
                                )
                              }
                              size="small"
                            />
                            <TextField
                              label="Описание"
                              value={moderationWorldDraft.game.description}
                              onChange={(event) => handleModerationWorldFieldChange('description', event.target.value)}
                              multiline
                              minRows={3}
                            />
                            <TextField
                              label="Стартовая сцена"
                              value={moderationWorldDraft.game.opening_scene}
                              onChange={(event) => handleModerationWorldFieldChange('opening_scene', event.target.value)}
                              multiline
                              minRows={4}
                            />
                            <Stack spacing={0.9}>
                              <Typography sx={{ fontWeight: 700 }}>Карточки инструкций</Typography>
                              {moderationWorldDraft.instruction_cards.map((card) => (
                                <Box
                                  key={card.id}
                                  sx={{
                                    borderRadius: '10px',
                                    border: 'var(--morius-border-width) solid rgba(184, 199, 214, 0.2)',
                                    p: 1,
                                  }}
                                >
                                  <Stack spacing={0.9}>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                                      <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary' }}>#{card.id}</Typography>
                                      <Switch
                                        checked={card.is_active}
                                        onChange={(event) =>
                                          handleModerationWorldInstructionCardChange(card.id, { is_active: event.target.checked })
                                        }
                                      />
                                    </Stack>
                                    <TextField
                                      label="Заголовок"
                                      value={card.title}
                                      onChange={(event) => handleModerationWorldInstructionCardChange(card.id, { title: event.target.value })}
                                      size="small"
                                    />
                                    <TextField
                                      label="Текст"
                                      value={card.content}
                                      onChange={(event) => handleModerationWorldInstructionCardChange(card.id, { content: event.target.value })}
                                      multiline
                                      minRows={3}
                                    />
                                  </Stack>
                                </Box>
                              ))}
                            </Stack>
                            <Stack spacing={0.9}>
                              <Typography sx={{ fontWeight: 700 }}>Карточки сюжета</Typography>
                              {moderationWorldDraft.plot_cards.map((card) => (
                                <Box
                                  key={card.id}
                                  sx={{
                                    borderRadius: '10px',
                                    border: 'var(--morius-border-width) solid rgba(184, 199, 214, 0.2)',
                                    p: 1,
                                  }}
                                >
                                  <Stack spacing={0.9}>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                                      <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary' }}>#{card.id}</Typography>
                                      <Switch
                                        checked={card.is_enabled}
                                        onChange={(event) => handleModerationWorldPlotCardChange(card.id, { is_enabled: event.target.checked })}
                                      />
                                    </Stack>
                                    <TextField
                                      label="Заголовок"
                                      value={card.title}
                                      onChange={(event) => handleModerationWorldPlotCardChange(card.id, { title: event.target.value })}
                                      size="small"
                                    />
                                    <TextField
                                      label="Триггеры через запятую"
                                      value={card.triggers.join(', ')}
                                      onChange={(event) =>
                                        handleModerationWorldPlotCardChange(card.id, {
                                          triggers: event.target.value
                                            .split(',')
                                            .map((item) => item.trim())
                                            .filter(Boolean),
                                        })
                                      }
                                      size="small"
                                    />
                                    <TextField
                                      label="Текст"
                                      value={card.content}
                                      onChange={(event) => handleModerationWorldPlotCardChange(card.id, { content: event.target.value })}
                                      multiline
                                      minRows={3}
                                    />
                                  </Stack>
                                </Box>
                              ))}
                            </Stack>
                            <Stack spacing={0.9}>
                              <Typography sx={{ fontWeight: 700 }}>Карточки мира</Typography>
                              {moderationWorldDraft.world_cards.map((card) => (
                                <Box
                                  key={card.id}
                                  sx={{
                                    borderRadius: '10px',
                                    border: 'var(--morius-border-width) solid rgba(184, 199, 214, 0.2)',
                                    p: 1,
                                  }}
                                >
                                  <Stack spacing={0.9}>
                                    <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary' }}>
                                      #{card.id} · {card.kind}
                                    </Typography>
                                    <TextField
                                      label="Заголовок"
                                      value={card.title}
                                      onChange={(event) => handleModerationWorldCardChange(card.id, { title: event.target.value })}
                                      size="small"
                                    />
                                    <TextField
                                      label="Триггеры через запятую"
                                      value={card.triggers.join(', ')}
                                      onChange={(event) =>
                                        handleModerationWorldCardChange(card.id, {
                                          triggers: event.target.value
                                            .split(',')
                                            .map((item) => item.trim())
                                            .filter(Boolean),
                                        })
                                      }
                                      size="small"
                                    />
                                    <TextField
                                      label="Описание"
                                      value={card.content}
                                      onChange={(event) => handleModerationWorldCardChange(card.id, { content: event.target.value })}
                                      multiline
                                      minRows={3}
                                    />
                                  </Stack>
                                </Box>
                              ))}
                            </Stack>
                          </Stack>
                        ) : moderationCharacterDraft ? (
                          <Stack spacing={1.05}>
                            <TextField
                              label="Имя персонажа"
                              value={moderationCharacterDraft.character.name}
                              onChange={(event) => handleModerationCharacterFieldChange('name', event.target.value)}
                              size="small"
                            />
                            <TextField
                              label="Триггеры через запятую"
                              value={moderationCharacterDraft.character.triggers.join(', ')}
                              onChange={(event) =>
                                handleModerationCharacterFieldChange(
                                  'triggers',
                                  event.target.value
                                    .split(',')
                                    .map((item) => item.trim())
                                    .filter(Boolean),
                                )
                              }
                              size="small"
                            />
                            <TextField
                              label="Краткая заметка"
                              value={moderationCharacterDraft.character.note}
                              onChange={(event) => handleModerationCharacterFieldChange('note', event.target.value)}
                              multiline
                              minRows={2}
                            />
                            <TextField
                              label="Описание"
                              value={moderationCharacterDraft.character.description}
                              onChange={(event) => handleModerationCharacterFieldChange('description', event.target.value)}
                              multiline
                              minRows={5}
                            />
                          </Stack>
                        ) : moderationInstructionDraft ? (
                          <Stack spacing={1.05}>
                            <TextField
                              label="Заголовок"
                              value={moderationInstructionDraft.template.title}
                              onChange={(event) => handleModerationInstructionFieldChange('title', event.target.value)}
                              size="small"
                            />
                            <TextField
                              label="Текст инструкции"
                              value={moderationInstructionDraft.template.content}
                              onChange={(event) => handleModerationInstructionFieldChange('content', event.target.value)}
                              multiline
                              minRows={8}
                            />
                          </Stack>
                        ) : null}

                        <TextField
                          label="Комментарий модератора"
                          value={moderationCommentDraft}
                          onChange={(event) => setModerationCommentDraft(event.target.value)}
                          multiline
                          minRows={3}
                          helperText="Комментарий увидит автор, если материал будет отклонён."
                        />

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <Button
                            variant="outlined"
                            onClick={() => void handleSaveModerationDraft()}
                            disabled={moderationActionDisabled}
                            sx={{
                              minHeight: 40,
                              borderColor: 'rgba(188, 202, 221, 0.36)',
                              color: 'var(--morius-text-primary)',
                            }}
                          >
                            Сохранить правки
                          </Button>
                          <Button
                            variant="contained"
                            onClick={() => void handleApproveModerationItem()}
                            disabled={moderationActionDisabled}
                            sx={{
                              minHeight: 40,
                              borderRadius: 'var(--morius-radius)',
                              border: 'var(--morius-border-width) solid var(--morius-card-border)',
                              backgroundColor: 'var(--morius-button-active)',
                            }}
                          >
                            Одобрить
                          </Button>
                          <Button
                            variant="contained"
                            onClick={() => void handleRejectModerationItem()}
                            disabled={moderationActionDisabled}
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
                            Отклонить
                          </Button>
                        </Stack>
                      </Stack>
                    )}
                  </Box>
                </Stack>
              </Stack>
            ) : (
              <Stack spacing={1.2}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.86rem' }}>Open bug reports</Typography>
                  <Button
                    variant="outlined"
                    onClick={() => void loadBugReports()}
                    disabled={!canUseAdminPanel || isLoadingBugReports || isApplyingReportAction}
                    sx={{
                      minHeight: 32,
                      textTransform: 'none',
                      borderColor: 'rgba(188, 202, 221, 0.36)',
                      color: 'var(--morius-text-primary)',
                    }}
                  >
                    Refresh
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
                  {isLoadingBugReports ? (
                    <Stack alignItems="center" justifyContent="center" sx={{ py: 2.2 }}>
                      <CircularProgress size={24} />
                    </Stack>
                  ) : bugReports.length === 0 ? (
                    <Typography sx={{ color: 'text.secondary', px: 0.8, py: 1 }}>No open bug reports</Typography>
                  ) : (
                    <Stack spacing={0.8}>
                      {bugReports.map((report) => {
                        const isSelected = report.id === selectedBugReportId
                        return (
                          <Button
                            key={report.id}
                            onClick={() => handleOpenBugReportDialog(report.id)}
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
                                {report.title}
                              </Typography>
                              <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }} noWrap>
                                Game #{report.source_game_id}: {report.source_game_title}
                              </Typography>
                              <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }} noWrap>
                                {report.reporter_name} - {formatReportDate(report.created_at)}
                              </Typography>
                              <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }} noWrap>
                                {getBugReportDescriptionPreview(report.description)}
                              </Typography>
                            </Stack>
                            <Typography sx={{ color: 'text.secondary', ml: 1.2, fontSize: '0.82rem' }}>#{report.id}</Typography>
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
        <DialogActions sx={{ px: 3, pb: 2.3, pt: 0.5, flexShrink: 0 }}>
          <Button onClick={onClose} sx={{ color: 'text.secondary' }}>
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={open && isBugReportDialogOpen && Boolean(selectedBugReport)}
        onClose={handleCloseBugReportDialog}
        maxWidth="sm"
        fullWidth
        sx={bugReportSheet.dialogSx}
        PaperProps={{
          ...bugReportSheet.paperTouchHandlers,
          sx: {
            borderRadius: 'var(--morius-radius)',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            color: 'var(--morius-text-primary)',
            boxShadow: '0 28px 70px rgba(0, 0, 0, 0.58)',
            ...bugReportSheet.paperSx,
          },
        }}
        BackdropProps={{
          sx: {
            ...bugReportSheet.backdropSx,
            backgroundColor: 'rgba(2, 4, 8, 0.8)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 0.9 }}>{selectedBugReport?.title || 'Bug report'}</DialogTitle>
        <DialogContent sx={{ pt: 0.4 }}>
          {selectedBugReport ? (
            <Stack spacing={1.15}>
              <Typography sx={{ color: 'text.secondary', fontSize: '0.86rem' }}>
                Game #{selectedBugReport.source_game_id}: {selectedBugReport.source_game_title}
              </Typography>
              <Typography sx={{ color: 'text.secondary', fontSize: '0.86rem' }}>
                Reporter: {selectedBugReport.reporter_name} - {formatReportDate(selectedBugReport.created_at)}
              </Typography>
              <Box
                sx={{
                  borderRadius: '10px',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                  backgroundColor: 'rgba(22, 30, 40, 0.34)',
                  p: 1.1,
                }}
              >
                <Typography sx={{ fontWeight: 700, mb: 0.35 }}>Description</Typography>
                <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                  {selectedBugReport.description || 'No description'}
                </Typography>
              </Box>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.3, pt: 0.6 }}>
          <Button onClick={handleCloseBugReportDialog} sx={{ color: 'text.secondary' }}>
            Cancel
          </Button>
          <Button
            onClick={handleGoToBugReportSnapshot}
            variant="contained"
            sx={{
              borderRadius: 'var(--morius-radius)',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              color: 'var(--morius-text-primary)',
              backgroundColor: 'var(--morius-button-active)',
              '&:hover': {
                backgroundColor: 'transparent',
              },
            }}
          >
            Open snapshot
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
        sx={characterReportSheet.dialogSx}
        PaperProps={{
          ...characterReportSheet.paperTouchHandlers,
          sx: {
            borderRadius: 'var(--morius-radius)',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            color: 'var(--morius-text-primary)',
            boxShadow: '0 28px 70px rgba(0, 0, 0, 0.58)',
            ...characterReportSheet.paperSx,
          },
        }}
        BackdropProps={{
          sx: {
            ...characterReportSheet.backdropSx,
            backgroundColor: 'rgba(2, 4, 8, 0.8)',
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
                <ProgressiveAvatar
                  src={selectedReportCharacterPayload.avatar_url || undefined}
                  alt={selectedReportCharacterPayload.name}
                  fallbackLabel={selectedReportCharacterPayload.name}
                  size={54}
                  scale={Math.max(1, Math.min(3, selectedReportCharacterPayload.avatar_scale || 1))}
                  sx={{
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-elevated-bg)',
                    color: 'var(--morius-text-primary)',
                    fontWeight: 800,
                  }}
                />
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
                backgroundColor: 'transparent',
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
        sx={instructionReportSheet.dialogSx}
        PaperProps={{
          ...instructionReportSheet.paperTouchHandlers,
          sx: {
            borderRadius: 'var(--morius-radius)',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            color: 'var(--morius-text-primary)',
            boxShadow: '0 28px 70px rgba(0, 0, 0, 0.58)',
            ...instructionReportSheet.paperSx,
          },
        }}
        BackdropProps={{
          sx: {
            ...instructionReportSheet.backdropSx,
            backgroundColor: 'rgba(2, 4, 8, 0.8)',
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
                backgroundColor: 'transparent',
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
