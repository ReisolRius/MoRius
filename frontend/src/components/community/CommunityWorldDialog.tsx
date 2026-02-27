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
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { icons } from '../../assets'
import type { StoryCommunityWorldReportReason } from '../../services/storyApi'
import type { StoryCommunityWorldComment, StoryCommunityWorldPayload } from '../../types/story'
import { buildWorldFallbackArtwork } from '../../utils/worldBackground'
import BaseDialog from '../dialogs/BaseDialog'

const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const APP_BUTTON_ACTIVE = 'var(--morius-button-active)'
const HEADING_FONT_SIZE = '40px'
const SUBHEADING_FONT_SIZE = '20px'
const BASE_GAP = '20px'

type CommunityPreviewBadgeTone = 'green' | 'blue'
type DialogTab = 'description' | 'cards' | 'comments'
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

type CommunityPreviewCardProps = {
  title: string
  content: string
  badge: string
  badgeTone?: CommunityPreviewBadgeTone
  avatarUrl?: string | null
  avatarScale?: number
}

function communityWorldKindBadgeLabel(kind: string): string {
  if (kind === 'main_hero') {
    return 'ГГ'
  }
  if (kind === 'npc') {
    return 'NPC'
  }
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
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
}

function formatCommentDateLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'вЂ”'
  }
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
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) {
    return false
  }
  return updatedAt - createdAt >= 1000
}

function resolveAuthorInitials(authorName: string): string {
  const cleaned = authorName.trim()
  if (!cleaned) {
    return '??'
  }
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0].slice(0, 1).toUpperCase()
  }
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase()
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (!value) {
    return
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(value)
    return
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard unavailable')
  }

  const temporaryTextarea = document.createElement('textarea')
  temporaryTextarea.value = value
  temporaryTextarea.style.position = 'fixed'
  temporaryTextarea.style.left = '-9999px'
  temporaryTextarea.style.top = '0'
  document.body.appendChild(temporaryTextarea)
  temporaryTextarea.focus()
  temporaryTextarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(temporaryTextarea)
  if (!copied) {
    throw new Error('Copy failed')
  }
}

function CommunityPreviewCard({
  title,
  content,
  badge,
  badgeTone = 'blue',
  avatarUrl = null,
  avatarScale = 1,
}: CommunityPreviewCardProps) {
  const safeScale = Math.max(0.6, Math.min(3, avatarScale || 1))
  const badgeColor = badgeTone === 'green' ? 'rgba(170, 238, 191, 0.96)' : 'rgba(168, 196, 231, 0.9)'
  const badgeBorder = badgeTone === 'green' ? 'rgba(128, 213, 162, 0.46)' : 'rgba(132, 168, 210, 0.42)'
  const fallbackLabel = title.trim().charAt(0).toUpperCase() || '•'

  return (
    <Box
      sx={{
        width: '100%',
        minHeight: 198,
        borderRadius: 'var(--morius-radius)',
        border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
        background: 'var(--morius-elevated-bg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ px: 1.3, py: 1.15, borderBottom: 'var(--morius-border-width) solid var(--morius-card-border)' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              background: 'var(--morius-elevated-bg)',
              overflow: 'hidden',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              color: APP_TEXT_PRIMARY,
              fontWeight: 800,
              fontSize: '0.9rem',
            }}
          >
            {avatarUrl ? (
              <Box
                component="img"
                src={avatarUrl}
                alt={title}
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: `scale(${safeScale})`,
                  transformOrigin: 'center center',
                }}
              />
            ) : (
              fallbackLabel
            )}
          </Box>
          <Typography
            sx={{
              color: APP_TEXT_PRIMARY,
              fontWeight: 800,
              fontSize: '1rem',
              lineHeight: 1.2,
              minWidth: 0,
              flex: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </Typography>
          <Typography
            sx={{
              color: badgeColor,
              fontSize: '0.68rem',
              lineHeight: 1,
              letterSpacing: 0.22,
              textTransform: 'uppercase',
              fontWeight: 700,
              border: `var(--morius-border-width) solid ${badgeBorder}`,
              borderRadius: '999px',
              px: 0.7,
              py: 0.22,
              flexShrink: 0,
            }}
          >
            {badge}
          </Typography>
        </Stack>
      </Box>
      <Box sx={{ px: 1.3, py: 1.2, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Typography
          sx={{
            color: 'rgba(208, 219, 235, 0.88)',
            fontSize: '0.94rem',
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
            display: '-webkit-box',
            WebkitLineClamp: 5,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
        >
          {content}
        </Typography>
      </Box>
    </Box>
  )
}

function DetailRow({ iconSrc, label, value }: { iconSrc: string; label: string; value: string }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
        <Box component="img" src={iconSrc} alt="" sx={{ width: 18, height: 18, opacity: 0.9, flexShrink: 0 }} />
        <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </Typography>
      </Stack>
      <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1rem', fontWeight: 700, textAlign: 'right' }}>{value}</Typography>
    </Stack>
  )
}

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
  const [tab, setTab] = useState<DialogTab>('description')
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
  const cardsCount = useMemo(() => {
    if (!worldPayload) {
      return 0
    }
    return worldPayload.instruction_cards.length + worldPayload.plot_cards.length + worldPayload.world_cards.length
  }, [worldPayload])
  const authorName = world?.author_name.trim() || 'Unknown author'
  const authorAvatarUrl = world?.author_avatar_url ?? null
  const authorInitials = resolveAuthorInitials(authorName)
  const hasWorldBeenReportedByUser = Boolean(world?.is_reported_by_user)
  const isActionLocked =
    isLaunching || isRatingSaving || isMyGamesToggleSaving || isReportSubmitting || Boolean(moderationControls?.isApplying)
  const canReportWorld = Boolean(world) && showGameplayActions && Boolean(onSubmitReport) && !hasWorldBeenReportedByUser
  const comments = worldPayload?.comments ?? []
  const isCommentActionLocked = isActionLocked || isCommentSubmitting || commentActionId !== null

  const shareLink = useMemo(() => {
    if (!world || typeof window === 'undefined') {
      return ''
    }
    return `${window.location.origin}/games/all?worldId=${world.id}`
  }, [world])

  const handleShareWorld = async () => {
    if (!world || isActionLocked) {
      return
    }
    try {
      await copyTextToClipboard(shareLink)
      setIsShareNoticeOpen(true)
    } catch {
      // Keep UI silent on clipboard restrictions.
    }
  }

  const handleOpenReportDialog = () => {
    if (!canReportWorld || isActionLocked) {
      return
    }
    setReportValidationError('')
    setIsReportDialogOpen(true)
  }

  const handleCloseReportDialog = () => {
    if (isReportSubmitting) {
      return
    }
    setIsReportDialogOpen(false)
    setReportValidationError('')
    setReportReasonDraft('')
    setReportDescriptionDraft('')
  }

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

  const handleSubmitReport = async () => {
    if (!canReportWorld || !onSubmitReport) {
      return
    }
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
  }

  const handleCreateComment = async () => {
    if (!onCreateComment || isCommentActionLocked) {
      return
    }
    const normalizedContent = commentDraft.trim()
    if (!normalizedContent) {
      setCommentValidationError('РљРѕРјРјРµРЅС‚Р°СЂРёР№ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј.')
      return
    }
    setCommentValidationError('')
    setIsCommentSubmitting(true)
    try {
      await onCreateComment(normalizedContent)
      setCommentDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РґРѕР±Р°РІРёС‚СЊ РєРѕРјРјРµРЅС‚Р°СЂРёР№'
      setCommentValidationError(detail)
    } finally {
      setIsCommentSubmitting(false)
    }
  }

  const handleStartEditComment = (comment: StoryCommunityWorldComment) => {
    if (isCommentActionLocked) {
      return
    }
    setEditingCommentId(comment.id)
    setEditingCommentDraft(comment.content)
    setCommentValidationError('')
  }

  const handleCancelEditComment = () => {
    if (isCommentActionLocked) {
      return
    }
    setEditingCommentId(null)
    setEditingCommentDraft('')
    setCommentValidationError('')
  }

  const handleSaveCommentEdit = async (commentId: number) => {
    if (!onUpdateComment || isCommentActionLocked) {
      return
    }
    const normalizedContent = editingCommentDraft.trim()
    if (!normalizedContent) {
      setCommentValidationError('РљРѕРјРјРµРЅС‚Р°СЂРёР№ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј.')
      return
    }
    setCommentValidationError('')
    setCommentActionId(commentId)
    try {
      await onUpdateComment(commentId, normalizedContent)
      setEditingCommentId(null)
      setEditingCommentDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ РєРѕРјРјРµРЅС‚Р°СЂРёР№'
      setCommentValidationError(detail)
    } finally {
      setCommentActionId(null)
    }
  }

  const handleDeleteComment = async (commentId: number) => {
    if (!onDeleteComment || isCommentActionLocked) {
      return
    }
    if (typeof window !== 'undefined' && !window.confirm('РЈРґР°Р»РёС‚СЊ РєРѕРјРјРµРЅС‚Р°СЂРёР№?')) {
      return
    }
    setCommentValidationError('')
    setCommentActionId(commentId)
    try {
      await onDeleteComment(commentId)
      if (editingCommentId === commentId) {
        setEditingCommentId(null)
        setEditingCommentDraft('')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ РєРѕРјРјРµРЅС‚Р°СЂРёР№'
      setCommentValidationError(detail)
    } finally {
      setCommentActionId(null)
    }
  }

  return (
    <BaseDialog
      open={open}
      onClose={() => {
        if (!isActionLocked) {
          setTab('description')
          setIsShareNoticeOpen(false)
          setIsReportNoticeOpen(false)
          setIsReportDialogOpen(false)
          setReportValidationError('')
          onClose()
        }
      }}
      maxWidth="lg"
      paperSx={{
        borderRadius: 'var(--morius-radius)',
        border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
        background: APP_CARD_BACKGROUND,
        boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
        animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
        overflow: 'hidden',
      }}
      rawChildren
    >
      <Box
        className="morius-scrollbar"
        sx={{
          p: 0,
          maxHeight: { xs: '88vh', md: '90vh' },
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
        }}
      >
        {isLoading || !world || !worldPayload ? (
          <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
            <CircularProgress size={30} />
          </Stack>
        ) : (
          <Stack spacing={0}>
            <Box
              sx={{
                position: 'relative',
                width: '100%',
                aspectRatio: '4 / 3',
                minHeight: { xs: 240, md: 300 },
                maxHeight: { xs: '52vh', md: '64vh' },
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  ...(world.cover_image_url
                    ? {
                        backgroundImage: `url(${world.cover_image_url})`,
                        backgroundSize: 'cover',
                        backgroundPosition: `${world.cover_position_x || 50}% ${world.cover_position_y || 50}%`,
                        backgroundRepeat: 'no-repeat',
                      }
                    : buildWorldFallbackArtwork(world.id)),
                }}
              />
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(180deg, rgba(6, 9, 14, 0.06) 0%, rgba(6, 9, 14, 0.58) 100%)',
                }}
              />
              <Typography
                sx={{
                  position: 'absolute',
                  left: 20,
                  right: 20,
                  bottom: 20,
                  color: APP_TEXT_PRIMARY,
                  fontWeight: 800,
                  fontSize: { xs: '2rem', md: HEADING_FONT_SIZE },
                  lineHeight: 1.1,
                  textShadow: 'none',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                }}
              >
                {world.title}
              </Typography>
            </Box>

            {showGameplayActions ? (
              <Box sx={{ borderTop: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`, borderBottom: `var(--morius-border-width) solid ${APP_BORDER_COLOR}` }}>
              <Stack
                direction={{ xs: 'column', xl: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'stretch', xl: 'center' }}
                sx={{ px: BASE_GAP, py: BASE_GAP, rowGap: BASE_GAP, columnGap: BASE_GAP }}
              >
                <Stack direction="row" flexWrap="wrap" sx={{ gap: BASE_GAP, flex: 1 }}>
                  <Box
                    sx={{
                      borderRadius: '12px',
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: 'var(--morius-elevated-bg)',
                      px: BASE_GAP,
                      py: BASE_GAP,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <Stack direction="row" alignItems="center" sx={{ columnGap: '10px' }}>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <Button
                          key={value}
                          onClick={() => onRate(value)}
                          disabled={isActionLocked}
                          sx={{
                            p: 0,
                            minWidth: 0,
                            minHeight: 0,
                            border: 'none',
                            borderRadius: 0,
                            backgroundColor: 'transparent',
                            '&:hover': {
                              backgroundColor: 'transparent',
                            },
                            '&:active': {
                              backgroundColor: 'transparent',
                            },
                          }}
                        >
                          <Box
                            component="img"
                            src={value <= ratingDraft ? icons.communityStarFilled : icons.communityStarOutline}
                            alt=""
                            sx={{ height: 20, width: 'auto', display: 'block' }}
                          />
                        </Button>
                      ))}
                    </Stack>
                    <Typography sx={{ ml: BASE_GAP, color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: SUBHEADING_FONT_SIZE }}>
                      {world.community_rating_avg.toFixed(1)}
                    </Typography>
                  </Box>

                  <Button
                    onClick={onToggleMyGames}
                    disabled={isActionLocked}
                    sx={{
                      minHeight: 0,
                      px: BASE_GAP,
                      py: BASE_GAP,
                      borderRadius: '12px',
                      textTransform: 'none',
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: isInMyGames ? 'rgba(40, 64, 48, 0.7)' : APP_BUTTON_ACTIVE,
                      color: APP_TEXT_PRIMARY,
                      columnGap: BASE_GAP,
                      '&:hover': {
                        backgroundColor: APP_BUTTON_HOVER,
                      },
                    }}
                  >
                    <Box
                      component="img"
                      src={isInMyGames ? icons.communityCheck : icons.communityAdd}
                      alt=""
                      sx={{ width: 20, height: 20, opacity: 0.95 }}
                    />
                    <Typography sx={{ fontSize: SUBHEADING_FONT_SIZE, fontWeight: 700, lineHeight: 1 }}>
                      {isInMyGames ? 'Добавлено' : 'Добавить'}
                    </Typography>
                  </Button>

                  <Button
                    onClick={() => void handleShareWorld()}
                    disabled={isActionLocked}
                    sx={{
                      minHeight: 0,
                      px: BASE_GAP,
                      py: BASE_GAP,
                      borderRadius: '12px',
                      textTransform: 'none',
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: APP_BUTTON_ACTIVE,
                      color: APP_TEXT_PRIMARY,
                      columnGap: BASE_GAP,
                      '&:hover': {
                        backgroundColor: APP_BUTTON_HOVER,
                      },
                    }}
                  >
                    <Box component="img" src={icons.communityShare} alt="" sx={{ width: 20, height: 20, opacity: 0.95 }} />
                    <Typography sx={{ fontSize: SUBHEADING_FONT_SIZE, fontWeight: 700, lineHeight: 1 }}>Поделиться</Typography>
                  </Button>
                  <Button
                    onClick={handleOpenReportDialog}
                    disabled={isActionLocked || !canReportWorld}
                    sx={{
                      minHeight: 0,
                      px: BASE_GAP,
                      py: BASE_GAP,
                      borderRadius: '12px',
                      textTransform: 'none',
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: hasWorldBeenReportedByUser ? 'rgba(76, 54, 54, 0.5)' : 'rgba(107, 63, 63, 0.58)',
                      color: APP_TEXT_PRIMARY,
                      '&:hover': {
                        backgroundColor: hasWorldBeenReportedByUser ? 'rgba(76, 54, 54, 0.5)' : 'rgba(134, 77, 77, 0.66)',
                      },
                    }}
                  >
                    {hasWorldBeenReportedByUser ? 'Жалоба отправлена' : 'Пожаловаться'}
                  </Button>
                </Stack>

                <Button
                  onClick={onPlay}
                  disabled={isLaunching || isLoading}
                  sx={{
                    minHeight: 0,
                    px: '60px',
                    py: BASE_GAP,
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 700,
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_BUTTON_ACTIVE,
                    color: APP_TEXT_PRIMARY,
                    fontSize: SUBHEADING_FONT_SIZE,
                    '&:hover': {
                      backgroundColor: APP_BUTTON_HOVER,
                    },
                  }}
                >
                  {isLaunching ? <CircularProgress size={18} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Играть'}
                </Button>
              </Stack>
              </Box>
            ) : null}

            <Box sx={{ px: BASE_GAP, pt: BASE_GAP }}>
              <Stack direction="row" flexWrap="wrap" sx={{ gap: BASE_GAP }}>
                <Button
                  onClick={() => setTab('description')}
                  sx={{
                    minHeight: 0,
                    px: BASE_GAP,
                    py: BASE_GAP,
                    borderRadius: '12px',
                    textTransform: 'none',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: tab === 'description' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                    color: APP_TEXT_PRIMARY,
                    columnGap: 1.1,
                    '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                  }}
                >
                  <Box component="img" src={icons.communityInfo} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
                  <Typography sx={{ fontSize: SUBHEADING_FONT_SIZE, fontWeight: 700, lineHeight: 1 }}>Описание</Typography>
                </Button>
                <Button
                  onClick={() => setTab('cards')}
                  sx={{
                    minHeight: 0,
                    px: BASE_GAP,
                    py: BASE_GAP,
                    borderRadius: '12px',
                    textTransform: 'none',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: tab === 'cards' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                    color: APP_TEXT_PRIMARY,
                    columnGap: 1.1,
                    '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                  }}
                >
                  <Box component="img" src={icons.communityCards} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
                  <Typography sx={{ fontSize: SUBHEADING_FONT_SIZE, fontWeight: 700, lineHeight: 1 }}>Карточки</Typography>
                </Button>
                <Button
                  onClick={() => setTab('comments')}
                  sx={{
                    minHeight: 0,
                    px: BASE_GAP,
                    py: BASE_GAP,
                    borderRadius: '12px',
                    textTransform: 'none',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: tab === 'comments' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                    color: APP_TEXT_PRIMARY,
                    columnGap: 1.1,
                    '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                  }}
                >
                  <Box component="img" src={icons.communityComments} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
                  <Typography sx={{ fontSize: SUBHEADING_FONT_SIZE, fontWeight: 700, lineHeight: 1 }}>Комментарии</Typography>
                </Button>
              </Stack>
            </Box>

            <Box sx={{ px: BASE_GAP, py: BASE_GAP }}>
              {tab === 'comments' ? (
                <Box
                  sx={{
                    borderRadius: 'var(--morius-radius)',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: 'var(--morius-elevated-bg)',
                    p: BASE_GAP,
                  }}
                >
                  <Stack spacing={BASE_GAP}>
                    {onCreateComment ? (
                      <Stack spacing={1}>
                        <TextField
                          value={commentDraft}
                          onChange={(event) => setCommentDraft(event.target.value.slice(0, 2000))}
                          disabled={isCommentActionLocked}
                          placeholder="Напишите комментарий к миру"
                          multiline
                          minRows={2}
                          maxRows={6}
                        />
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                          <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.84rem' }}>
                            {commentDraft.trim().length}/2000
                          </Typography>
                          <Button
                            onClick={() => void handleCreateComment()}
                            disabled={isCommentActionLocked || commentDraft.trim().length === 0}
                            sx={{
                              minHeight: 0,
                              px: BASE_GAP,
                              py: 0.85,
                              borderRadius: '12px',
                              textTransform: 'none',
                              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                              backgroundColor: APP_BUTTON_ACTIVE,
                              color: APP_TEXT_PRIMARY,
                              '&:hover': {
                                backgroundColor: APP_BUTTON_HOVER,
                              },
                            }}
                          >
                            {isCommentSubmitting ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Опубликовать'}
                          </Button>
                        </Stack>
                      </Stack>
                    ) : null}

                    {commentValidationError ? (
                      <Alert severity="error" sx={{ borderRadius: '12px' }}>
                        {commentValidationError}
                      </Alert>
                    ) : null}

                    {comments.length === 0 ? (
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem' }}>
                        Комментариев пока нет. Будьте первым.
                      </Typography>
                    ) : (
                      <Stack spacing={1.1}>
                        {comments.map((comment) => {
                          const isOwnComment = currentUserId !== null && comment.user_id === currentUserId
                          const isEditingComment = editingCommentId === comment.id
                          const isRowPending = commentActionId === comment.id
                          const commentAuthorName = comment.user_display_name.trim() || 'Unknown author'
                          const commentAuthorInitials = resolveAuthorInitials(commentAuthorName)
                          const authorScale = Math.max(1, Math.min(3, comment.user_avatar_scale || 1))
                          return (
                            <Box
                              key={comment.id}
                              sx={{
                                borderRadius: '12px',
                                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                                backgroundColor: APP_CARD_BACKGROUND,
                                p: 1.2,
                              }}
                            >
                              <Stack spacing={0.9}>
                                <Stack direction="row" spacing={0.8} alignItems="center">
                                  <Box
                                    sx={{
                                      width: 34,
                                      height: 34,
                                      borderRadius: '50%',
                                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                                      overflow: 'hidden',
                                      display: 'grid',
                                      placeItems: 'center',
                                      color: APP_TEXT_PRIMARY,
                                      fontWeight: 800,
                                      fontSize: '0.78rem',
                                      background: APP_CARD_BACKGROUND,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {comment.user_avatar_url ? (
                                      <Box
                                        component="img"
                                        src={comment.user_avatar_url}
                                        alt={commentAuthorName}
                                        sx={{
                                          width: '100%',
                                          height: '100%',
                                          objectFit: 'cover',
                                          transform: `scale(${authorScale})`,
                                          transformOrigin: 'center center',
                                        }}
                                      />
                                    ) : (
                                      commentAuthorInitials
                                    )}
                                  </Box>
                                  <Stack sx={{ minWidth: 0, flex: 1 }} spacing={0.15}>
                                    <Typography
                                      sx={{
                                        color: APP_TEXT_PRIMARY,
                                        fontWeight: 700,
                                        fontSize: '0.94rem',
                                        lineHeight: 1.2,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {commentAuthorName}
                                    </Typography>
                                    <Stack direction="row" spacing={0.65} alignItems="center">
                                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.76rem', lineHeight: 1.2 }}>
                                        {formatCommentDateLabel(comment.created_at)}
                                      </Typography>
                                      {isCommentEdited(comment) ? (
                                        <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.74rem', lineHeight: 1.2 }}>
                                          (edited)
                                        </Typography>
                                      ) : null}
                                    </Stack>
                                  </Stack>
                                </Stack>

                                {isEditingComment ? (
                                  <Stack spacing={0.75}>
                                    <TextField
                                      value={editingCommentDraft}
                                      onChange={(event) => setEditingCommentDraft(event.target.value.slice(0, 2000))}
                                      disabled={isCommentActionLocked}
                                      multiline
                                      minRows={2}
                                      maxRows={6}
                                    />
                                    <Stack direction="row" spacing={0.7} justifyContent="flex-end">
                                      <Button onClick={handleCancelEditComment} disabled={isCommentActionLocked} sx={{ color: APP_TEXT_SECONDARY }}>
                                        Отмена
                                      </Button>
                                      <Button
                                        onClick={() => void handleSaveCommentEdit(comment.id)}
                                        disabled={isCommentActionLocked || editingCommentDraft.trim().length === 0}
                                        sx={{
                                          minHeight: 0,
                                          px: 1.1,
                                          py: 0.7,
                                          borderRadius: '10px',
                                          textTransform: 'none',
                                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                                          backgroundColor: APP_BUTTON_ACTIVE,
                                          color: APP_TEXT_PRIMARY,
                                          '&:hover': {
                                            backgroundColor: APP_BUTTON_HOVER,
                                          },
                                        }}
                                      >
                                        {isRowPending ? <CircularProgress size={14} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Сохранить'}
                                      </Button>
                                    </Stack>
                                  </Stack>
                                ) : (
                                  <Typography
                                    sx={{
                                      color: APP_TEXT_SECONDARY,
                                      fontSize: '0.98rem',
                                      lineHeight: 1.48,
                                      whiteSpace: 'pre-wrap',
                                      overflowWrap: 'anywhere',
                                      wordBreak: 'break-word',
                                    }}
                                  >
                                    {comment.content}
                                  </Typography>
                                )}

                                {isOwnComment && !isEditingComment ? (
                                  <Stack direction="row" spacing={0.7} justifyContent="flex-end">
                                    <Button
                                      onClick={() => handleStartEditComment(comment)}
                                      disabled={isCommentActionLocked}
                                      sx={{ minHeight: 0, textTransform: 'none', color: APP_TEXT_SECONDARY }}
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      onClick={() => void handleDeleteComment(comment.id)}
                                      disabled={isCommentActionLocked}
                                      sx={{ minHeight: 0, textTransform: 'none', color: 'rgba(246, 177, 177, 0.95)' }}
                                    >
                                      {isRowPending ? <CircularProgress size={14} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Delete'}
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
              ) : null}

              {tab === 'cards' ? (
                <Stack spacing={BASE_GAP}>
                  <Stack spacing={BASE_GAP}>
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: SUBHEADING_FONT_SIZE }}>Карточки инструкций</Typography>
                    {worldPayload.instruction_cards.length === 0 ? (
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem' }}>Нет карточек инструкций.</Typography>
                    ) : (
                      <Box sx={{ display: 'grid', gap: BASE_GAP, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
                        {worldPayload.instruction_cards.map((card) => (
                          <CommunityPreviewCard key={card.id} title={card.title} content={card.content} badge="ИНСТРУКЦИЯ" />
                        ))}
                      </Box>
                    )}
                  </Stack>

                  <Stack spacing={BASE_GAP}>
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: SUBHEADING_FONT_SIZE }}>Карточки сюжета</Typography>
                    {worldPayload.plot_cards.length === 0 ? (
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem' }}>Нет карточек сюжета.</Typography>
                    ) : (
                      <Box sx={{ display: 'grid', gap: BASE_GAP, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
                        {worldPayload.plot_cards.map((card) => (
                          <CommunityPreviewCard key={card.id} title={card.title} content={card.content} badge="СЮЖЕТ" />
                        ))}
                      </Box>
                    )}
                  </Stack>

                  <Stack spacing={BASE_GAP}>
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: SUBHEADING_FONT_SIZE }}>Карточки мира и персонажей</Typography>
                    {worldPayload.world_cards.length === 0 ? (
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem' }}>Нет карточек мира.</Typography>
                    ) : (
                      <Box sx={{ display: 'grid', gap: BASE_GAP, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
                        {worldPayload.world_cards.map((card) => (
                          <CommunityPreviewCard
                            key={card.id}
                            title={card.title}
                            content={card.content}
                            badge={communityWorldKindBadgeLabel(card.kind)}
                            badgeTone={card.kind === 'world' ? 'blue' : 'green'}
                            avatarUrl={card.avatar_url}
                            avatarScale={card.avatar_scale}
                          />
                        ))}
                      </Box>
                    )}
                  </Stack>
                </Stack>
              ) : null}

              {tab === 'description' ? (
                <Box
                  sx={{
                    display: 'grid',
                    gap: BASE_GAP,
                    gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 360px' },
                    alignItems: 'start',
                  }}
                >
                  <Stack spacing={BASE_GAP}>
                    <Stack
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      role={onAuthorClick ? 'button' : undefined}
                      tabIndex={onAuthorClick ? 0 : undefined}
                      onClick={() => {
                        if (!onAuthorClick || !world.author_id) {
                          return
                        }
                        onAuthorClick(world.author_id)
                      }}
                      onKeyDown={(event) => {
                        if (!onAuthorClick || !world.author_id) {
                          return
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onAuthorClick(world.author_id)
                        }
                      }}
                      sx={{
                        width: 'fit-content',
                        cursor: onAuthorClick ? 'pointer' : 'default',
                        borderRadius: '8px',
                        '&:focus-visible': onAuthorClick
                          ? {
                              outline: '2px solid rgba(205, 223, 246, 0.62)',
                              outlineOffset: '2px',
                            }
                          : undefined,
                      }}
                    >
                      <Box
                        sx={{
                          width: 34,
                          height: 34,
                          borderRadius: '50%',
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          overflow: 'hidden',
                          display: 'grid',
                          placeItems: 'center',
                          color: APP_TEXT_PRIMARY,
                          fontWeight: 800,
                          fontSize: '0.84rem',
                          background: APP_CARD_BACKGROUND,
                        }}
                      >
                        {authorAvatarUrl ? (
                          <Box component="img" src={authorAvatarUrl} alt={authorName} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          authorInitials
                        )}
                      </Box>
                      <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: SUBHEADING_FONT_SIZE, fontWeight: 700 }}>
                        {authorName}
                      </Typography>
                    </Stack>

                    <Stack spacing={BASE_GAP}>
                      <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: SUBHEADING_FONT_SIZE, fontWeight: 700 }}>Описание</Typography>
                      <Typography
                        sx={{
                          color: APP_TEXT_SECONDARY,
                          fontSize: '1rem',
                          lineHeight: 1.56,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                        }}
                      >
                        {world.description || 'Описание мира пока отсутствует.'}
                      </Typography>
                    </Stack>
                  </Stack>

                  <Stack spacing={BASE_GAP}>
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: SUBHEADING_FONT_SIZE }}>Подробности</Typography>
                    <Stack spacing={BASE_GAP}>
                      <DetailRow iconSrc={icons.communityPlay} label="Игр проведено" value={formatCompactCount(world.community_launches)} />
                      <DetailRow iconSrc={icons.communityStarFilled} label="Оценено" value={`${world.community_rating_count} раз`} />
                      <DetailRow iconSrc={icons.communityEdit} label="Создано" value={formatDateLabel(world.created_at)} />
                      <DetailRow iconSrc={icons.reload} label="Обновлено" value={formatDateLabel(world.updated_at)} />
                      <DetailRow iconSrc={icons.world} label="Готовые карточки" value={`${cardsCount} шт`} />
                      <DetailRow iconSrc={icons.communityAge} label="Возраст" value={world.age_rating} />
                      <Stack spacing={1}>
                        <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem', fontWeight: 700 }}>Жанры</Typography>
                        {world.genres.length === 0 ? (
                          <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem' }}>Не указаны</Typography>
                        ) : (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
                            {world.genres.map((genre) => (
                              <Box
                                key={genre}
                                sx={{
                                  px: 1,
                                  py: 0.35,
                                  borderRadius: '999px',
                                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                                  backgroundColor: APP_CARD_BACKGROUND,
                                  color: APP_TEXT_PRIMARY,
                                  fontSize: '0.86rem',
                                }}
                              >
                                {genre}
                              </Box>
                            ))}
                          </Box>
                        )}
                      </Stack>
                    </Stack>
                  </Stack>
                </Box>
              ) : null}

              {moderationControls ? (
                <Box
                  sx={{
                    mt: BASE_GAP,
                    borderRadius: '12px',
                    border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                    backgroundColor: 'var(--morius-elevated-bg)',
                    p: BASE_GAP,
                  }}
                >
                  <Stack spacing={1.1}>
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: SUBHEADING_FONT_SIZE }}>
                      Жалобы
                    </Typography>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.95rem' }}>
                      Количество: {moderationControls.reportCount}
                    </Typography>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.95rem' }}>
                      Категория: {moderationControls.reasonLabel}
                    </Typography>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.95rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {moderationControls.description || 'Описание жалобы не указано.'}
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <Button
                        onClick={moderationControls.onDismissReport}
                        disabled={moderationControls.isApplying}
                        variant="outlined"
                        sx={{
                          minHeight: 40,
                          borderColor: 'rgba(188, 202, 221, 0.36)',
                          color: APP_TEXT_PRIMARY,
                        }}
                      >
                        Отклонить жалобу
                      </Button>
                      <Button
                        onClick={moderationControls.onRemoveWorld}
                        disabled={moderationControls.isApplying}
                        variant="contained"
                        sx={{
                          minHeight: 40,
                          borderRadius: 'var(--morius-radius)',
                          border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                          backgroundColor: 'rgba(192, 91, 91, 0.38)',
                          color: APP_TEXT_PRIMARY,
                          '&:hover': {
                            backgroundColor: 'rgba(199, 102, 102, 0.5)',
                          },
                        }}
                      >
                        Удалить мир
                      </Button>
                    </Stack>
                  </Stack>
                </Box>
              ) : null}
            </Box>

            <Stack direction="row" justifyContent="flex-end" sx={{ px: BASE_GAP, pb: BASE_GAP }}>
              <Button
                onClick={() => {
                  setTab('description')
                  setIsShareNoticeOpen(false)
                  setIsReportNoticeOpen(false)
                  setIsReportDialogOpen(false)
                  setReportValidationError('')
                  onClose()
                }}
                sx={{ color: APP_TEXT_SECONDARY }}
                disabled={isActionLocked}
              >
                Закрыть
              </Button>
            </Stack>
          </Stack>
        )}
      </Box>

      <Snackbar
        open={isShareNoticeOpen}
        autoHideDuration={1000}
        onClose={() => setIsShareNoticeOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          icon={false}
          severity="success"
          sx={{
            borderRadius: '12px',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            backgroundColor: 'rgba(21, 30, 25, 0.96)',
            color: APP_TEXT_PRIMARY,
            fontWeight: 700,
          }}
        >
          Ссылка скопирована!
        </Alert>
      </Snackbar>

      <Snackbar
        open={isReportNoticeOpen}
        autoHideDuration={1300}
        onClose={() => setIsReportNoticeOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          icon={false}
          severity="success"
          sx={{
            borderRadius: '12px',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            backgroundColor: 'rgba(21, 30, 25, 0.96)',
            color: APP_TEXT_PRIMARY,
            fontWeight: 700,
          }}
        >
          Жалоба отправлена
        </Alert>
      </Snackbar>

      <Dialog
        open={isReportDialogOpen}
        onClose={handleCloseReportDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 'var(--morius-radius)',
            border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
            boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          },
        }}
        BackdropProps={{
          sx: {
            backgroundColor: 'rgba(2, 4, 8, 0.76)',
            backdropFilter: 'blur(5px)',
          },
        }}
      >
        <DialogTitle>Нарушение</DialogTitle>
        <DialogContent sx={{ pt: 0.8 }}>
          <Stack spacing={1.2}>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.95rem' }}>Опишите причину жалобы.</Typography>
            <Select
              size="small"
              value={reportReasonDraft}
              onChange={(event) => setReportReasonDraft(String(event.target.value))}
              disabled={isReportSubmitting}
            >
              <MenuItem value="">Не выбрано</MenuItem>
              {REPORT_REASON_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
            <TextField
              value={reportDescriptionDraft}
              onChange={(event) => setReportDescriptionDraft(event.target.value)}
              disabled={isReportSubmitting}
              multiline
              minRows={3}
              maxRows={8}
              inputProps={{ maxLength: 2000 }}
              placeholder="Опишите причину жалобы."
            />
            {reportValidationError ? (
              <Alert severity="error" sx={{ borderRadius: '12px' }}>
                {reportValidationError}
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={handleCloseReportDialog} disabled={isReportSubmitting} sx={{ color: APP_TEXT_SECONDARY }}>
            Отмена
          </Button>
          <Button
            onClick={() => void handleSubmitReport()}
            disabled={isReportSubmitting}
            variant="contained"
            sx={{
              minHeight: 40,
              borderRadius: 'var(--morius-radius)',
              border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
              backgroundColor: 'rgba(102, 65, 65, 0.6)',
              color: APP_TEXT_PRIMARY,
              '&:hover': {
                backgroundColor: 'rgba(126, 76, 76, 0.72)',
              },
            }}
          >
            {isReportSubmitting ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Отправить'}
          </Button>
        </DialogActions>
      </Dialog>
    </BaseDialog>
  )
}

export default CommunityWorldDialog
