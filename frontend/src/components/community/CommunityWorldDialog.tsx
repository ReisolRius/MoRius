import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  SvgIcon,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'

// Raw SVG imports for theme-adaptive icons via ThemedSvgIcon
import communityPlayRaw from '../../assets/icons/community-play.svg?raw'
import communityStarFilledRaw from '../../assets/icons/community-star-filled.svg?raw'
import communityStarOutlineRaw from '../../assets/icons/community-star-outline.svg?raw'
import communityAddRaw from '../../assets/icons/community-add.svg?raw'
import communityCheckRaw from '../../assets/icons/community-check.svg?raw'
import communityShareRaw from '../../assets/icons/community-share.svg?raw'
import communityEditRaw from '../../assets/icons/community-edit.svg?raw'
import reloadRaw from '../../assets/icons/reload.svg?raw'
import worldRaw from '../../assets/icons/world.svg?raw'
import communityAgeRaw from '../../assets/icons/community-age.svg?raw'
import sendRaw from '../../assets/icons/send.svg?raw'

import type { StoryCommunityWorldReportReason } from '../../services/storyApi'
import { useMoriusThemeController } from '../../theme'
import type { StoryCommunityWorldComment, StoryCommunityWorldPayload } from '../../types/story'
import { buildWorldFallbackArtwork } from '../../utils/worldBackground'
import DeferredImage from '../media/DeferredImage'
import ProgressiveAvatar from '../media/ProgressiveAvatar'
import ProgressiveImage from '../media/ProgressiveImage'
import TextLimitIndicator from '../TextLimitIndicator'
import BaseDialog from '../dialogs/BaseDialog'
import useMobileDialogSheet from '../dialogs/useMobileDialogSheet'
import ThemedSvgIcon from '../icons/ThemedSvgIcon'

// ─── Design tokens ─────────────────────────────────────────────────────────────
const APP_CARD_BG = 'var(--community-world-card-bg, var(--morius-card-bg))'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_ELEVATED_BG = 'var(--community-world-elevated-bg, var(--morius-elevated-bg))'
const SECTION_GAP = '20px'
const SECTION_PX = '20px'

// ─── Types ──────────────────────────────────────────────────────────────────────
type CardTab = 'instructions' | 'plot' | 'characters'

type CommunityWorldReportPayload = {
  reason: StoryCommunityWorldReportReason
  description: string
}

type CommunityWorldModerationControls = {
  reportCount: number
  reasonLabel: string
  description: string
  isApplying: boolean
  onRemoveWorld: () => void
  onDismissReport: () => void
}

type CommunityWorldDialogProps = {
  open: boolean
  isLoading: boolean
  worldPayload: StoryCommunityWorldPayload | null
  currentUserId?: number | null
  ratingDraft: number
  isRatingSaving: boolean
  isLaunching: boolean
  isInMyGames: boolean
  isMyGamesToggleSaving: boolean
  onClose: () => void
  onPlay: () => void
  onRate: (value: number) => void
  onToggleMyGames: () => void
  onAuthorClick?: (authorId: number) => void
  onSubmitReport?: (payload: CommunityWorldReportPayload) => Promise<void> | void
  onCreateComment?: (content: string) => Promise<void> | void
  onUpdateComment?: (commentId: number, content: string) => Promise<void> | void
  onDeleteComment?: (commentId: number) => Promise<void> | void
  isReportSubmitting?: boolean
  showGameplayActions?: boolean
  moderationControls?: CommunityWorldModerationControls | null
}

const REPORT_REASON_OPTIONS: Array<{ value: StoryCommunityWorldReportReason; label: string }> = [
  { value: 'cp', label: 'ЦП' },
  { value: 'politics', label: 'Политика' },
  { value: 'racism', label: 'Расизм' },
  { value: 'nationalism', label: 'Национализм' },
  { value: 'other', label: 'Другое' },
]

// ─── Helpers ────────────────────────────────────────────────────────────────────
function communityWorldKindBadgeLabel(kind: string): string {
  if (kind === 'main_hero') return 'ГГ'
  if (kind === 'npc') return 'NPC'
  return 'МИР'
}

function formatCompactCount(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(Math.max(0, value))
}

function formatDateLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
}

function formatCommentDateLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isCommentEdited(comment: StoryCommunityWorldComment): boolean {
  const createdAt = Date.parse(comment.created_at)
  const updatedAt = Date.parse(comment.updated_at)
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return false
  return updatedAt - createdAt >= 1000
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (!value) return
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  if (typeof document === 'undefined') throw new Error('Clipboard unavailable')
  const el = document.createElement('textarea')
  el.value = value
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  document.body.appendChild(el)
  el.focus()
  el.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(el)
  if (!ok) throw new Error('Copy failed')
}

// ─── ActionPill ─────────────────────────────────────────────────────────────────
// Uses Box component="button" to bypass BaseDialog's !important MUI Button CSS resets.
type ActionPillProps = {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  active?: boolean
  danger?: boolean
  primary?: boolean
  fullWidth?: boolean
}

function ActionPill({ onClick, disabled, children, active, danger, primary, fullWidth }: ActionPillProps) {
  let bg = APP_ELEVATED_BG
  let hoverBg = 'var(--morius-button-hover)'
  let borderColor = APP_BORDER_COLOR
  let color = APP_TEXT_PRIMARY

  if (primary) {
    bg = 'var(--morius-accent)'
    hoverBg = 'color-mix(in srgb, var(--morius-accent) 90%, #ffffff)'
    borderColor = 'var(--morius-accent)'
    color = '#111111'
  } else if (active) {
    bg = 'var(--morius-button-active)'
  } else if (danger) {
    bg = 'rgba(107, 63, 63, 0.55)'
    hoverBg = 'rgba(134, 77, 77, 0.66)'
  }

  return (
    <Box
      component="button"
      onClick={onClick}
      disabled={disabled}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: 40,
        px: '12px',
        borderRadius: '12px',
        border: `var(--morius-border-width) solid ${borderColor}`,
        backgroundColor: bg,
        color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
        fontWeight: 700,
        fontSize: '0.88rem',
        lineHeight: 1,
        transition: 'background-color 140ms ease',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        width: fullWidth ? '100%' : 'auto',
        justifyContent: fullWidth ? 'center' : 'flex-start',
        '&:not(:disabled):hover': { backgroundColor: hoverBg },
        '&:disabled': { opacity: 0.45 },
      }}
    >
      {children}
    </Box>
  )
}

// ─── DetailRow ───────────────────────────────────────────────────────────────────
const DetailRow = memo(function DetailRow({ iconRaw, label, value }: { iconRaw: string; label: string; value: string }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
      <Stack direction="row" alignItems="center" spacing={0.8} sx={{ minWidth: 0, flex: 1 }}>
        <ThemedSvgIcon markup={iconRaw} size={16} sx={{ flexShrink: 0, opacity: 0.8, color: APP_TEXT_SECONDARY }} />
        <Typography
          sx={{
            color: APP_TEXT_SECONDARY,
            fontSize: '0.9rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Typography>
      </Stack>
      <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '0.9rem', fontWeight: 700, textAlign: 'right', flexShrink: 0 }}>
        {value}
      </Typography>
    </Stack>
  )
})

// ─── CommunityPreviewCard (new style: image-top + text-bottom) ──────────────────
type CommunityPreviewCardProps = {
  title: string
  content: string
  badge: string
  avatarUrl?: string | null
  avatarScale?: number
}

const CommunityPreviewCard = memo(function CommunityPreviewCard({
  title,
  content,
  badge,
  avatarUrl = null,
  avatarScale = 1,
}: CommunityPreviewCardProps) {
  const safeScale = Math.max(0.6, Math.min(3, avatarScale || 1))
  const fallbackLetter = title.trim().charAt(0).toUpperCase() || '?'

  return (
    <Box
      sx={{
        borderRadius: '12px',
        border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
        background: APP_ELEVATED_BG,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Image area */}
      <Box
        sx={{
          position: 'relative',
          height: 128,
          flexShrink: 0,
          overflow: { xs: 'hidden', md: 'visible' },
          borderRadius: '12px 12px 0 0',
        }}
      >
        {avatarUrl ? (
          <ProgressiveImage
            src={avatarUrl}
            alt={title}
            loading="eager"
            fetchPriority="high"
            objectFit="cover"
            loaderSize={22}
            containerSx={{
              width: '100%',
              height: '100%',
            }}
            imgSx={{
              transform: `scale(${safeScale})`,
              transformOrigin: 'center center',
            }}
            fallback={
              <Box
                sx={{
                  width: '100%',
                  height: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'color-mix(in srgb, var(--morius-elevated-bg) 55%, var(--morius-card-border))',
                }}
              >
                <Typography
                  aria-hidden
                  sx={{
                    fontSize: '2rem',
                    fontWeight: 800,
                    color: APP_TEXT_SECONDARY,
                    opacity: 0.28,
                    userSelect: 'none',
                  }}
                >
                  {fallbackLetter}
                </Typography>
              </Box>
            }
          />
        ) : (
          <Box
            sx={{
              width: '100%',
              height: '100%',
              display: 'grid',
              placeItems: 'center',
              background: 'color-mix(in srgb, var(--morius-elevated-bg) 55%, var(--morius-card-border))',
            }}
          >
            <Typography
              aria-hidden
              sx={{
                fontSize: '2rem',
                fontWeight: 800,
                color: APP_TEXT_SECONDARY,
                opacity: 0.28,
                userSelect: 'none',
              }}
            >
              {fallbackLetter}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Text area */}
      <Box
        sx={{
          px: '12px',
          pt: '10px',
          pb: '10px',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          gap: '5px',
          minHeight: 90,
        }}
      >
        <Typography
          sx={{
            color: APP_TEXT_PRIMARY,
            fontWeight: 700,
            fontSize: '0.9rem',
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </Typography>
        <Typography
          sx={{
            color: APP_TEXT_SECONDARY,
            fontSize: '0.8rem',
            lineHeight: 1.45,
            flex: 1,
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
        >
          {content}
        </Typography>
        <Typography
          sx={{
            color: APP_TEXT_PRIMARY,
            fontSize: '0.68rem',
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            mt: 'auto',
            pt: '4px',
            opacity: 0.75,
          }}
        >
          {badge}
        </Typography>
      </Box>
    </Box>
  )
})

// ─── CardTabButton ───────────────────────────────────────────────────────────────
function CardTabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-pressed={active}
      sx={{
        minHeight: 42,
        px: { xs: '18px', sm: '28px' },
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? 'var(--morius-button-active)' : 'transparent',
        border: 'none',
        borderRadius: '9999px',
        color: active ? 'var(--morius-title-text)' : APP_TEXT_PRIMARY,
        fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
        fontWeight: 700,
        fontSize: '0.88rem',
        lineHeight: 1,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background-color 160ms ease, color 140ms ease, opacity 140ms ease',
        '&:hover': {
          backgroundColor: active ? 'var(--morius-button-active)' : 'transparent',
          color: active ? 'var(--morius-title-text)' : APP_TEXT_PRIMARY,
          opacity: active ? 1 : 0.84,
        },
        '&:focus-visible': {
          outline: '2px solid color-mix(in srgb, var(--morius-accent) 52%, transparent)',
          outlineOffset: 2,
        },
      }}
    >
      {label}
    </Box>
  )
}

// ─── Main dialog ─────────────────────────────────────────────────────────────────
function CommunityWorldDialog({
  open,
  isLoading,
  worldPayload,
  currentUserId = null,
  ratingDraft,
  isRatingSaving,
  isLaunching,
  isInMyGames,
  isMyGamesToggleSaving,
  onClose,
  onPlay,
  onRate,
  onToggleMyGames,
  onAuthorClick,
  onSubmitReport,
  onCreateComment,
  onUpdateComment,
  onDeleteComment,
  isReportSubmitting = false,
  showGameplayActions = true,
  moderationControls = null,
}: CommunityWorldDialogProps) {
  const { themeId } = useMoriusThemeController()
  const isYamiTheme = themeId === 'yami-rius'
  const isRiusDungeonTheme = themeId === 'rius-dungeon'
  const isDarkPureTheme = isYamiTheme || isRiusDungeonTheme
  const [cardTab, setCardTab] = useState<CardTab>('instructions')
  const [isShareNoticeOpen, setIsShareNoticeOpen] = useState(false)
  const [isReportNoticeOpen, setIsReportNoticeOpen] = useState(false)
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false)
  const [reportReasonDraft, setReportReasonDraft] = useState<string>('')
  const [reportDescriptionDraft, setReportDescriptionDraft] = useState('')
  const [reportValidationError, setReportValidationError] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [commentValidationError, setCommentValidationError] = useState('')
  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false)
  const [commentActionId, setCommentActionId] = useState<number | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editingCommentDraft, setEditingCommentDraft] = useState('')

  const world = worldPayload?.world ?? null
  const worldCardsWithoutMainHero = useMemo(() => {
    if (!worldPayload) return []
    return worldPayload.world_cards.filter((c) => c.kind !== 'main_hero')
  }, [worldPayload])

  const cardsCount = useMemo(() => {
    if (!worldPayload) return 0
    return worldPayload.instruction_cards.length + worldPayload.plot_cards.length + worldCardsWithoutMainHero.length
  }, [worldCardsWithoutMainHero.length, worldPayload])

  const authorName = world?.author_name.trim() || 'Unknown author'
  const authorAvatarUrl = world?.author_avatar_url ?? null
  const hasWorldBeenReportedByUser = Boolean(world?.is_reported_by_user)
  const isActionLocked =
    isLaunching || isRatingSaving || isMyGamesToggleSaving || isReportSubmitting || Boolean(moderationControls?.isApplying)
  const canReportWorld = Boolean(world) && showGameplayActions && Boolean(onSubmitReport) && !hasWorldBeenReportedByUser
  const comments = worldPayload?.comments ?? []
  const isCommentActionLocked = isActionLocked || isCommentSubmitting || commentActionId !== null

  const shareLink = useMemo(() => {
    if (!world || typeof window === 'undefined') return ''
    return `${window.location.origin}/games/all?worldId=${world.id}`
  }, [world])

  const isMobileLayout = useMediaQuery('(max-width:899.95px)')
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [scrollbarRailWidth, setScrollbarRailWidth] = useState(0)

  const dialogBackdropSx = useMemo(
    () => ({
      backgroundColor: isDarkPureTheme ? 'rgba(0, 0, 0, 0.92)' : 'rgba(1, 4, 8, 0.88)',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
    }),
    [isDarkPureTheme],
  )

  useEffect(() => {
    if (!open || isMobileLayout || typeof window === 'undefined') {
      setScrollbarRailWidth(0)
      return
    }

    const node = scrollContainerRef.current
    if (!node) {
      return
    }

    let frameId: number | null = null

    const updateScrollbarRailWidth = () => {
      const currentNode = scrollContainerRef.current
      if (!currentNode) {
        return
      }
      const nextWidth = Math.max(0, currentNode.offsetWidth - currentNode.clientWidth)
      setScrollbarRailWidth((previousWidth) => (previousWidth === nextWidth ? previousWidth : nextWidth))
    }

    const scheduleUpdate = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        updateScrollbarRailWidth()
      })
    }

    scheduleUpdate()

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleUpdate) : null
    resizeObserver?.observe(node)
    window.addEventListener('resize', scheduleUpdate)

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [open, isMobileLayout, isLoading, world?.id, cardsCount, comments.length])

  const desktopScrollbarRailWidth = !isMobileLayout ? scrollbarRailWidth : 0

  // Active cards derived from the selected card tab
  const activeCards = useMemo(() => {
    if (!worldPayload) return []
    if (cardTab === 'instructions') {
      return worldPayload.instruction_cards.map((c) => ({
        id: c.id,
        title: c.title,
        content: c.content,
        badge: 'ИНСТРУКЦИЯ',
        avatarUrl: null as string | null,
        avatarScale: 1,
      }))
    }
    if (cardTab === 'plot') {
      return worldPayload.plot_cards.map((c) => ({
        id: c.id,
        title: c.title,
        content: c.triggers && c.triggers.length > 0 ? `${c.content}\nТриггеры: ${c.triggers.join(', ')}` : c.content,
        badge: 'СЮЖЕТ',
        avatarUrl: null as string | null,
        avatarScale: 1,
      }))
    }
    return worldCardsWithoutMainHero.map((c) => ({
      id: c.id,
      title: c.title,
      content: c.content,
      badge: communityWorldKindBadgeLabel(c.kind),
      avatarUrl: (c.avatar_url as string | null | undefined) ?? null,
      avatarScale: (c.avatar_scale as number | undefined) ?? 1,
    }))
  }, [cardTab, worldPayload, worldCardsWithoutMainHero])

  const activeCardsEmptyLabel = useMemo(() => {
    if (cardTab === 'instructions') return 'Нет карточек инструкций.'
    if (cardTab === 'plot') return 'Нет карточек сюжета.'
    return 'Нет карточек мира.'
  }, [cardTab])

  // ─── Handlers ─────────────────────────────────────────────────────────────────
  const handleShareWorld = useCallback(async () => {
    if (!world || isActionLocked) return
    try {
      await copyTextToClipboard(shareLink)
      setIsShareNoticeOpen(true)
    } catch {
      // silent
    }
  }, [world, isActionLocked, shareLink])

  const handleOpenReportDialog = useCallback(() => {
    if (!canReportWorld || isActionLocked) return
    setReportValidationError('')
    setIsReportDialogOpen(true)
  }, [canReportWorld, isActionLocked])

  const handleCloseReportDialog = useCallback(() => {
    if (isReportSubmitting) return
    setIsReportDialogOpen(false)
    setReportValidationError('')
    setReportReasonDraft('')
    setReportDescriptionDraft('')
  }, [isReportSubmitting])

  const reportDialogSheet = useMobileDialogSheet({ onClose: handleCloseReportDialog, disabled: isReportSubmitting })

  const handleSubmitReport = useCallback(async () => {
    if (!canReportWorld || !onSubmitReport) return
    const normalizedReason = reportReasonDraft.trim()
    const normalizedDescription = reportDescriptionDraft.trim()
    if (!normalizedReason) {
      setReportValidationError('Выберите категорию нарушения.')
      return
    }
    if (!normalizedDescription) {
      setReportValidationError('Опишите причину жалобы.')
      return
    }
    setReportValidationError('')
    try {
      await onSubmitReport({
        reason: normalizedReason as StoryCommunityWorldReportReason,
        description: normalizedDescription,
      })
      setIsReportDialogOpen(false)
      setReportReasonDraft('')
      setReportDescriptionDraft('')
      setIsReportNoticeOpen(true)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось отправить жалобу'
      setReportValidationError(detail)
    }
  }, [canReportWorld, onSubmitReport, reportReasonDraft, reportDescriptionDraft])

  const handleCreateComment = useCallback(async () => {
    if (!onCreateComment || isCommentActionLocked) return
    const normalizedContent = commentDraft.trim()
    if (!normalizedContent) {
      setCommentValidationError('Комментарий не может быть пустым.')
      return
    }
    setCommentValidationError('')
    setIsCommentSubmitting(true)
    try {
      await onCreateComment(normalizedContent)
      setCommentDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось добавить комментарий'
      setCommentValidationError(detail)
    } finally {
      setIsCommentSubmitting(false)
    }
  }, [onCreateComment, isCommentActionLocked, commentDraft])

  const handleStartEditComment = useCallback((comment: StoryCommunityWorldComment) => {
    if (isCommentActionLocked) return
    setEditingCommentId(comment.id)
    setEditingCommentDraft(comment.content)
    setCommentValidationError('')
  }, [isCommentActionLocked])

  const handleCancelEditComment = useCallback(() => {
    if (isCommentActionLocked) return
    setEditingCommentId(null)
    setEditingCommentDraft('')
    setCommentValidationError('')
  }, [isCommentActionLocked])

  const handleSaveCommentEdit = useCallback(async (commentId: number) => {
    if (!onUpdateComment || isCommentActionLocked) return
    const normalizedContent = editingCommentDraft.trim()
    if (!normalizedContent) {
      setCommentValidationError('Комментарий не может быть пустым.')
      return
    }
    setCommentValidationError('')
    setCommentActionId(commentId)
    try {
      await onUpdateComment(commentId, normalizedContent)
      setEditingCommentId(null)
      setEditingCommentDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обновить комментарий'
      setCommentValidationError(detail)
    } finally {
      setCommentActionId(null)
    }
  }, [onUpdateComment, isCommentActionLocked, editingCommentDraft])

  const handleDeleteComment = useCallback(async (commentId: number) => {
    if (!onDeleteComment || isCommentActionLocked) return
    if (typeof window !== 'undefined' && !window.confirm('Удалить комментарий?')) return
    setCommentValidationError('')
    setCommentActionId(commentId)
    try {
      await onDeleteComment(commentId)
      if (editingCommentId === commentId) {
        setEditingCommentId(null)
        setEditingCommentDraft('')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось удалить комментарий'
      setCommentValidationError(detail)
    } finally {
      setCommentActionId(null)
    }
  }, [onDeleteComment, isCommentActionLocked, editingCommentId])

  const handleClose = useCallback(() => {
    if (isActionLocked) return
    setIsShareNoticeOpen(false)
    setIsReportNoticeOpen(false)
    setIsReportDialogOpen(false)
    setReportValidationError('')
    onClose()
  }, [isActionLocked, onClose])

  useEffect(() => {
    if (!open) {
      setCommentDraft('')
      setCommentValidationError('')
      setIsCommentSubmitting(false)
      setCommentActionId(null)
      setEditingCommentId(null)
      setEditingCommentDraft('')
    }
  }, [open])

  useEffect(() => {
    setCommentValidationError('')
    setCommentActionId(null)
    setEditingCommentId(null)
    setEditingCommentDraft('')
  }, [world?.id])

  return (
    <>
      <BaseDialog
        open={open}
        onClose={handleClose}
        maxWidth="md"
        backdropSx={dialogBackdropSx}
        paperSx={{
          '--community-world-card-bg': isYamiTheme
            ? '#121212'
            : isRiusDungeonTheme
              ? '#111418'
              : 'var(--morius-card-bg)',
          '--community-world-elevated-bg': isYamiTheme
            ? '#1a1a1a'
            : isRiusDungeonTheme
              ? '#1a1e21'
              : 'var(--morius-elevated-bg)',
          borderRadius: 'var(--morius-radius)',
          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.56)',
          animation: 'morius-dialog-pop 260ms cubic-bezier(0.22, 1, 0.36, 1)',
          overflow: { xs: 'hidden', md: 'visible' },
          maxWidth: { xs: '100vw', md: '960px' },
          width: '100%',
        }}
        rawChildren
      >
        {/* ── Scrollable content ── */}
        <Box
          ref={scrollContainerRef}
          className="morius-scrollbar"
          sx={{
            maxHeight: { xs: '90vh', md: '88vh' },
            width: desktopScrollbarRailWidth > 0 ? `calc(100% + ${desktopScrollbarRailWidth}px)` : '100%',
            mr: desktopScrollbarRailWidth > 0 ? `-${desktopScrollbarRailWidth}px` : 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            overscrollBehavior: 'contain',
            scrollbarGutter: 'auto',
            paddingRight: 0,
            boxSizing: 'border-box',
            '--morius-scrollbar-offset': '0px',
            '--morius-scrollbar-gutter': 'auto',
          }}
        >
          {isLoading || !world || !worldPayload ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : (
            <Stack spacing={0}>
              {/* ══ HERO IMAGE ══ */}
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  height: { xs: 220, sm: 280, md: 320 },
                  flexShrink: 0,
                  overflow: 'hidden',
                  borderTopLeftRadius: 'var(--morius-radius)',
                  borderTopRightRadius: 'var(--morius-radius)',
                  backgroundColor: APP_ELEVATED_BG,
                }}
              >
                {/* Fallback gradient artwork */}
                <Box sx={{ position: 'absolute', inset: 0, ...buildWorldFallbackArtwork(world.id) }} />
                {/* Cover image */}
                <DeferredImage
                  src={world.cover_image_url}
                  alt=""
                  rootMargin="0px"
                  objectFit="cover"
                  objectPosition={`${world.cover_position_x || 50}% ${world.cover_position_y || 50}%`}
                  fetchPriority="high"
                />
                {/* Gradient overlay */}
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(180deg, rgba(6,9,14,0.1) 0%, rgba(6,9,14,0.16) 38%, rgba(6,9,14,0.78) 100%)',
                  }}
                />
                {/* Title */}
                <Typography
                  sx={{
                    position: 'absolute',
                    left: SECTION_PX,
                    right: SECTION_PX,
                    bottom: 16,
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: { xs: '1.4rem', sm: '1.8rem', md: '2.1rem' },
                    lineHeight: 1.15,
                    textShadow: '0 2px 10px rgba(0,0,0,0.55)',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  {world.title}
                </Typography>
              </Box>

              {/* ══ ACTION BAR ══ */}
              {showGameplayActions ? (
               <Box
                   sx={{
                     px: SECTION_PX,
                     py: '12px',
                     borderTop: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                     borderBottom: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                   }}
                 >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ xs: 'stretch', sm: 'center' }}
                    gap={1}
                  >
                    {/* Left group */}
                    <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
                      {/* Stars + rating score */}
                      <Box
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          height: 40,
                          px: '12px',
                          borderRadius: '12px',
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          backgroundColor: APP_ELEVATED_BG,
                          flexShrink: 0,
                        }}
                      >
                        {[1, 2, 3, 4, 5].map((v) => (
                          <Box
                            key={v}
                            component="button"
                            onClick={() => onRate(v)}
                            disabled={isActionLocked}
                            sx={{
                              background: 'none',
                              border: 'none',
                              p: 0,
                              cursor: isActionLocked ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              opacity: isActionLocked ? 0.6 : 1,
                            }}
                          >
                            <ThemedSvgIcon
                              markup={v <= ratingDraft ? communityStarFilledRaw : communityStarOutlineRaw}
                              size={18}
                              sx={{ color: v <= ratingDraft ? 'var(--morius-accent)' : APP_TEXT_SECONDARY }}
                            />
                          </Box>
                        ))}
                        <Typography
                          sx={{
                            ml: '4px',
                            color: APP_TEXT_PRIMARY,
                            fontWeight: 700,
                            fontSize: '0.9rem',
                            lineHeight: 1,
                          }}
                        >
                          {world.community_rating_avg.toFixed(1)}
                        </Typography>
                      </Box>

                      {/* Add to my games */}
                      <ActionPill
                        onClick={onToggleMyGames}
                        disabled={isActionLocked}
                        active={isInMyGames}
                      >
                        <ThemedSvgIcon
                          markup={isInMyGames ? communityCheckRaw : communityAddRaw}
                          size={16}
                          sx={{ color: 'inherit' }}
                        />
                        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                          {isInMyGames ? 'Добавлено' : 'Добавить'}
                        </Box>
                      </ActionPill>

                      {/* Share */}
                      <ActionPill
                        onClick={() => void handleShareWorld()}
                        disabled={isActionLocked}
                      >
                        <ThemedSvgIcon markup={communityShareRaw} size={16} sx={{ color: 'inherit' }} />
                        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                          Поделиться
                        </Box>
                      </ActionPill>

                      {/* Report */}
                      <ActionPill
                        onClick={handleOpenReportDialog}
                        disabled={isActionLocked || !canReportWorld}
                        danger={!hasWorldBeenReportedByUser}
                      >
                        <SvgIcon viewBox="0 0 24 24" sx={{ width: 15, height: 15, color: 'inherit' }}>
                          <path d="M6 3h2v18H6V3Zm3 1h9l-1.2 3L18 10H9V4Z" fill="currentColor" />
                        </SvgIcon>
                        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                          {hasWorldBeenReportedByUser ? 'Жалоба отправлена' : 'Пожаловаться'}
                        </Box>
                      </ActionPill>
                    </Stack>

                    {/* Play */}
                    <ActionPill
                      onClick={onPlay}
                      disabled={isLaunching || isLoading}
                      primary
                      fullWidth={isMobileLayout}
                    >
                      {isLaunching ? (
                        <CircularProgress size={15} sx={{ color: 'var(--morius-accent)' }} />
                      ) : (
                        <ThemedSvgIcon markup={communityPlayRaw} size={16} sx={{ color: 'inherit' }} />
                      )}
                      Играть
                    </ActionPill>
                  </Stack>
                </Box>
              ) : null}

              {/* ══ DESCRIPTION + DETAILS ══ */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: '1fr 268px' },
                  gap: SECTION_GAP,
                  px: SECTION_PX,
                  pt: '16px',
                  pb: '16px',
                  borderBottom: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                }}
              >
                {/* Left: description */}
                <Stack spacing={1.5}>
                  <Typography
                    sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: '1.05rem' }}
                  >
                    Описание
                  </Typography>
                  <Typography
                    sx={{
                      color: APP_TEXT_SECONDARY,
                      fontSize: '0.92rem',
                      lineHeight: 1.58,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                    }}
                  >
                    {world.description || 'Описание мира пока отсутствует.'}
                  </Typography>
                </Stack>

                {/* Right: details sidebar */}
                <Stack spacing={1.5}>
                  <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: '1.05rem' }}>
                    Подробности
                  </Typography>

                  {/* Author row */}
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    role={onAuthorClick ? 'button' : undefined}
                    tabIndex={onAuthorClick ? 0 : undefined}
                    onClick={() => {
                      if (!onAuthorClick || !world.author_id) return
                      onAuthorClick(world.author_id)
                    }}
                    onKeyDown={(e) => {
                      if (!onAuthorClick || !world.author_id) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onAuthorClick(world.author_id)
                      }
                    }}
                    sx={{
                      width: 'fit-content',
                      cursor: onAuthorClick ? 'pointer' : 'default',
                      borderRadius: '8px',
                      '&:focus-visible': onAuthorClick
                        ? { outline: '2px solid color-mix(in srgb, var(--morius-accent) 60%, transparent)', outlineOffset: 2 }
                        : undefined,
                    }}
                  >
                    <ProgressiveAvatar
                      src={authorAvatarUrl}
                      alt={authorName}
                      fallbackLabel={authorName}
                      size={32}
                    />
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '0.92rem', fontWeight: 700 }}>
                      {authorName}
                    </Typography>
                  </Stack>

                  {/* Stat rows */}
                  <Stack
                    spacing={1}
                    sx={{
                      borderRadius: '10px',
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      background: APP_ELEVATED_BG,
                      px: 1.5,
                      py: 1.2,
                    }}
                  >
                    <DetailRow iconRaw={communityPlayRaw} label="Сыграно" value={`${formatCompactCount(world.community_launches)} раз`} />
                    <DetailRow iconRaw={communityStarFilledRaw} label="Оценено" value={`${world.community_rating_count} раз`} />
                    <DetailRow iconRaw={communityEditRaw} label="Создано" value={formatDateLabel(world.created_at)} />
                    <DetailRow iconRaw={reloadRaw} label="Обновлено" value={formatDateLabel(world.updated_at)} />
                    <DetailRow iconRaw={worldRaw} label="Карточки" value={`${cardsCount} шт`} />
                    <DetailRow iconRaw={communityAgeRaw} label="Возраст" value={world.age_rating} />
                  </Stack>

                  {/* Genres */}
                  {world.genres.length > 0 ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {world.genres.map((genre) => (
                        <Typography
                          key={genre}
                          sx={{
                            color: 'var(--morius-accent)',
                            fontSize: '0.84rem',
                            fontWeight: 700,
                          }}
                        >
                          #{genre}
                        </Typography>
                      ))}
                    </Box>
                  ) : (
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.88rem' }}>
                      Жанры не указаны
                    </Typography>
                  )}
                </Stack>
              </Box>

              {/* ══ CARDS SECTION ══ */}
              <Box sx={{ px: SECTION_PX, pt: '16px', pb: '16px', borderBottom: `var(--morius-border-width) solid ${APP_BORDER_COLOR}` }}>
                <Stack spacing={1.5}>
                  {/* Heading */}
                  <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 800, fontSize: '1.05rem' }}>
                    Карточки{' '}
                    <Box component="span" sx={{ color: APP_TEXT_SECONDARY, fontWeight: 400, fontSize: '0.9rem' }}>
                      ({cardsCount})
                    </Box>
                  </Typography>

                  {/* Sub-tabs */}
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: { xs: '8px', sm: '12px' },
                    }}
                  >
                    <CardTabButton
                      label={`Инструкции (${worldPayload.instruction_cards.length})`}
                      active={cardTab === 'instructions'}
                      onClick={() => setCardTab('instructions')}
                    />
                    <CardTabButton
                      label={`Сюжет (${worldPayload.plot_cards.length})`}
                      active={cardTab === 'plot'}
                      onClick={() => setCardTab('plot')}
                    />
                    <CardTabButton
                      label={`Персонажи (${worldCardsWithoutMainHero.length})`}
                      active={cardTab === 'characters'}
                      onClick={() => setCardTab('characters')}
                    />
                  </Box>

                  {/* Card grid */}
                  {activeCards.length === 0 ? (
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.92rem', py: 1 }}>
                      {activeCardsEmptyLabel}
                    </Typography>
                  ) : (
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                          xs: '1fr',
                          sm: 'repeat(2, minmax(0, 1fr))',
                          md: 'repeat(3, minmax(0, 1fr))',
                        },
                        gap: '10px',
                      }}
                    >
                      {activeCards.map((card) => (
                        <CommunityPreviewCard
                          key={card.id}
                          title={card.title}
                          content={card.content}
                          badge={card.badge}
                          avatarUrl={card.avatarUrl}
                          avatarScale={card.avatarScale}
                        />
                      ))}
                    </Box>
                  )}
                </Stack>
              </Box>

              {/* ══ COMMENTS SECTION ══ */}
              <Box sx={{ px: SECTION_PX, pt: '16px', pb: '16px' }}>
                <Stack spacing={1.5}>
                  <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: '1.05rem' }}>
                    Комментарии
                    {comments.length > 0 ? (
                      <Box component="span" sx={{ color: APP_TEXT_SECONDARY, fontWeight: 400, fontSize: '0.9rem', ml: 0.8 }}>
                        ({comments.length})
                      </Box>
                    ) : null}
                  </Typography>

                  {/* New comment input */}
                  {onCreateComment ? (
                    <Stack spacing={0.8}>
                      <TextField
                        value={commentDraft}
                        onChange={(e) => setCommentDraft(e.target.value.slice(0, 2000))}
                        disabled={isCommentActionLocked}
                        placeholder="Напишите комментарий к миру…"
                        multiline
                        minRows={1}
                        maxRows={5}
                        inputProps={{ maxLength: 2000 }}
                        slotProps={{
                          input: {
                            endAdornment: (
                              <Box
                                component="button"
                                onClick={() => void handleCreateComment()}
                                disabled={isCommentActionLocked || commentDraft.trim().length === 0}
                                type="button"
                                sx={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: 36,
                                  height: 36,
                                  minWidth: 36,
                                  minHeight: 36,
                                  borderRadius: '8px',
                                  border: 'none',
                                  backgroundColor: 'var(--morius-accent)',
                                  cursor: 'pointer',
                                  transition: 'opacity 140ms ease',
                                  mr: 0.5,
                                  mb: 'auto',
                                  flexShrink: 0,
                                  '&:hover:not(:disabled)': { opacity: 0.9 },
                                  '&:disabled': { opacity: 0.45, cursor: 'not-allowed' },
                               }}
                              >
                                {isCommentSubmitting ? (
                                  <CircularProgress size={14} sx={{ color: '#111111' }} />
                                ) : (
                                  <ThemedSvgIcon 
                                    markup={sendRaw} 
                                    size={16} 
                                    sx={{ color: '#111111' }}
                                  />
                                )}
                              </Box>
                            ),
                          },
                        }}
                        helperText={<TextLimitIndicator currentLength={commentDraft.length} maxLength={2000} />}
                        FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.5 } } as object}
                      />
                    </Stack>
                  ) : null}

                  {/* Validation error */}
                  {commentValidationError ? (
                    <Alert severity="error" sx={{ borderRadius: '10px' }}>
                      {commentValidationError}
                    </Alert>
                  ) : null}

                  {/* Comment list */}
                  {comments.length === 0 ? (
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.92rem' }}>
                      Комментариев пока нет. Будьте первым.
                    </Typography>
                  ) : (
                    <Stack spacing={1}>
                      {comments.map((comment) => {
                        const isOwnComment = currentUserId !== null && comment.user_id === currentUserId
                        const isEditingComment = editingCommentId === comment.id
                        const isRowPending = commentActionId === comment.id
                        const commentAuthorName = comment.user_display_name.trim() || 'Unknown author'
                        const authorScale = Math.max(1, Math.min(3, comment.user_avatar_scale || 1))

                        return (
                          <Box
                            key={comment.id}
                            sx={{
                              borderRadius: '10px',
                              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                              backgroundColor: APP_CARD_BG,
                              p: 1.25,
                            }}
                          >
                            <Stack spacing={0.8}>
                              {/* Author header */}
                              <Stack direction="row" spacing={0.9} alignItems="center">
                                <ProgressiveAvatar
                                  src={comment.user_avatar_url}
                                  alt={commentAuthorName}
                                  fallbackLabel={commentAuthorName}
                                  size={30}
                                  scale={authorScale}
                                />
                                <Stack sx={{ minWidth: 0, flex: 1 }} spacing={0.1}>
                                  <Typography
                                    sx={{
                                      color: APP_TEXT_PRIMARY,
                                      fontWeight: 700,
                                      fontSize: '0.88rem',
                                      lineHeight: 1.2,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {commentAuthorName}
                                  </Typography>
                                  <Stack direction="row" spacing={0.5} alignItems="center">
                                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.74rem', lineHeight: 1 }}>
                                      {formatCommentDateLabel(comment.created_at)}
                                    </Typography>
                                    {isCommentEdited(comment) ? (
                                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.7rem', lineHeight: 1 }}>
                                        (изм.)
                                      </Typography>
                                    ) : null}
                                  </Stack>
                                </Stack>
                              </Stack>

                              {/* Comment body / edit field */}
                              {isEditingComment ? (
                                <Stack spacing={0.6}>
                                  <TextField
                                    value={editingCommentDraft}
                                    onChange={(e) => setEditingCommentDraft(e.target.value.slice(0, 2000))}
                                    disabled={isCommentActionLocked}
                                    multiline
                                    minRows={2}
                                    maxRows={5}
                                    inputProps={{ maxLength: 2000 }}
                                    helperText={<TextLimitIndicator currentLength={editingCommentDraft.length} maxLength={2000} />}
                                    FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.4 } } as object}
                                  />
                                  <Stack direction="row" spacing={0.6} justifyContent="flex-end">
                                    <Button
                                      onClick={handleCancelEditComment}
                                      disabled={isCommentActionLocked}
                                      sx={{ color: APP_TEXT_SECONDARY, textTransform: 'none', minHeight: 0 }}
                                    >
                                      Отмена
                                    </Button>
                                    <ActionPill
                                      onClick={() => void handleSaveCommentEdit(comment.id)}
                                      disabled={isCommentActionLocked || editingCommentDraft.trim().length === 0}
                                    >
                                      {isRowPending ? (
                                        <CircularProgress size={13} sx={{ color: APP_TEXT_PRIMARY }} />
                                      ) : (
                                        'Сохранить'
                                      )}
                                    </ActionPill>
                                  </Stack>
                                </Stack>
                              ) : (
                                <Typography
                                  sx={{
                                    color: APP_TEXT_SECONDARY,
                                    fontSize: '0.9rem',
                                    lineHeight: 1.5,
                                    whiteSpace: 'pre-wrap',
                                    overflowWrap: 'anywhere',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {comment.content}
                                </Typography>
                              )}

                              {/* Own comment actions */}
                              {isOwnComment && !isEditingComment ? (
                                <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                  <Button
                                    onClick={() => handleStartEditComment(comment)}
                                    disabled={isCommentActionLocked}
                                    sx={{ minHeight: 0, textTransform: 'none', color: APP_TEXT_SECONDARY, fontSize: '0.8rem' }}
                                  >
                                    Изменить
                                  </Button>
                                  <Button
                                    onClick={() => void handleDeleteComment(comment.id)}
                                    disabled={isCommentActionLocked}
                                    sx={{ minHeight: 0, textTransform: 'none', color: 'rgba(246,177,177,0.9)', fontSize: '0.8rem' }}
                                  >
                                    {isRowPending ? (
                                      <CircularProgress size={13} sx={{ color: APP_TEXT_PRIMARY }} />
                                    ) : (
                                      'Удалить'
                                    )}
                                  </Button>
                                </Stack>
                              ) : null}
                            </Stack>
                          </Box>
                        )
                      })}
                    </Stack>
                  )}
                </Stack>
              </Box>

              {/* ══ MODERATION SECTION ══ */}
              {moderationControls ? (
                <Box
                  sx={{
                    mx: SECTION_PX,
                    mb: '16px',
                    borderRadius: '10px',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_ELEVATED_BG,
                    p: 1.5,
                  }}
                >
                  <Stack spacing={1}>
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: '1rem' }}>
                      Жалобы
                    </Typography>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.88rem' }}>
                      Количество: {moderationControls.reportCount}
                    </Typography>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.88rem' }}>
                      Категория: {moderationControls.reasonLabel}
                    </Typography>
                    <Typography
                      sx={{
                        color: APP_TEXT_SECONDARY,
                        fontSize: '0.88rem',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {moderationControls.description || 'Описание жалобы не указано.'}
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} pt={0.5}>
                      <Button
                        onClick={moderationControls.onDismissReport}
                        disabled={moderationControls.isApplying}
                        variant="outlined"
                        sx={{
                          minHeight: 38,
                          borderColor: `${APP_BORDER_COLOR} !important`,
                          color: `${APP_TEXT_PRIMARY} !important`,
                          textTransform: 'none',
                        }}
                      >
                        Отклонить жалобу
                      </Button>
                      <Button
                        onClick={moderationControls.onRemoveWorld}
                        disabled={moderationControls.isApplying}
                        variant="contained"
                        sx={{
                          minHeight: 38,
                          borderRadius: 'var(--morius-radius)',
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR} !important`,
                          backgroundColor: 'rgba(192,91,91,0.38) !important',
                          color: `${APP_TEXT_PRIMARY} !important`,
                          textTransform: 'none',
                          '&:hover': { backgroundColor: 'rgba(199,102,102,0.5) !important' },
                        }}
                      >
                        Удалить мир
                      </Button>
                    </Stack>
                  </Stack>
                </Box>
              ) : null}
            </Stack>
          )}
        </Box>
      </BaseDialog>

      {/* ── Share snackbar ── */}
      <Snackbar
        open={isShareNoticeOpen}
        autoHideDuration={1200}
        onClose={() => setIsShareNoticeOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          icon={false}
          severity="success"
          sx={{
            borderRadius: '10px',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            backgroundColor: 'rgba(21,30,25,0.96)',
            color: APP_TEXT_PRIMARY,
            fontWeight: 700,
          }}
        >
          Ссылка скопирована!
        </Alert>
      </Snackbar>

      {/* ── Report snackbar ── */}
      <Snackbar
        open={isReportNoticeOpen}
        autoHideDuration={1500}
        onClose={() => setIsReportNoticeOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          icon={false}
          severity="success"
          sx={{
            borderRadius: '10px',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            backgroundColor: 'rgba(21,30,25,0.96)',
            color: APP_TEXT_PRIMARY,
            fontWeight: 700,
          }}
        >
          Жалоба отправлена
        </Alert>
      </Snackbar>

      {/* ── Report sub-dialog ── */}
      <Dialog
        open={isReportDialogOpen}
        onClose={handleCloseReportDialog}
        maxWidth="sm"
        fullWidth
        sx={reportDialogSheet.dialogSx}
        PaperProps={{
          ...reportDialogSheet.paperTouchHandlers,
          sx: {
            borderRadius: 'var(--morius-radius)',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BG,
            boxShadow: '0 24px 56px rgba(0,0,0,0.5)',
            ...reportDialogSheet.paperSx,
          },
        }}
        BackdropProps={{
          sx: {
            ...reportDialogSheet.backdropSx,
            backgroundColor: 'rgba(2,5,10,0.75)',
          },
        }}
      >
        <DialogTitle sx={{ color: APP_TEXT_PRIMARY }}>Нарушение</DialogTitle>
        <DialogContent sx={{ pt: 0.8 }}>
          <Stack spacing={1.2}>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>
              Опишите причину жалобы.
            </Typography>
            <Select
              size="small"
              value={reportReasonDraft}
              onChange={(e) => setReportReasonDraft(String(e.target.value))}
              disabled={isReportSubmitting}
            >
              <MenuItem value="">Не выбрано</MenuItem>
              {REPORT_REASON_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
            <TextField
              value={reportDescriptionDraft}
              onChange={(e) => setReportDescriptionDraft(e.target.value)}
              disabled={isReportSubmitting}
              multiline
              minRows={3}
              maxRows={8}
              inputProps={{ maxLength: 2000 }}
              placeholder="Опишите причину жалобы."
              helperText={<TextLimitIndicator currentLength={reportDescriptionDraft.length} maxLength={2000} />}
              FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.5 } } as object}
            />
            {reportValidationError ? (
              <Alert severity="error" sx={{ borderRadius: '10px' }}>
                {reportValidationError}
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button
            onClick={handleCloseReportDialog}
            disabled={isReportSubmitting}
            sx={{ color: APP_TEXT_SECONDARY, textTransform: 'none' }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => void handleSubmitReport()}
            disabled={isReportSubmitting}
            variant="contained"
            sx={{
              minHeight: 38,
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR} !important`,
              backgroundColor: 'rgba(102,65,65,0.6) !important',
              color: `${APP_TEXT_PRIMARY} !important`,
              textTransform: 'none',
              '&:hover': { backgroundColor: 'rgba(126,76,76,0.72) !important' },
            }}
          >
            {isReportSubmitting ? <CircularProgress size={15} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Отправить'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default CommunityWorldDialog
