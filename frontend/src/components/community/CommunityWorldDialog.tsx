import { Alert, Box, Button, CircularProgress, Snackbar, Stack, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { icons } from '../../assets'
import type { StoryCommunityWorldPayload } from '../../types/story'
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

type CommunityWorldDialogProps = {
  open: boolean
  isLoading: boolean
  worldPayload: StoryCommunityWorldPayload | null
  ratingDraft: number
  isRatingSaving: boolean
  isLaunching: boolean
  isInMyGames: boolean
  isMyGamesToggleSaving: boolean
  onClose: () => void
  onPlay: () => void
  onRate: (value: number) => void
  onToggleMyGames: () => void
}

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
  ratingDraft,
  isRatingSaving,
  isLaunching,
  isInMyGames,
  isMyGamesToggleSaving,
  onClose,
  onPlay,
  onRate,
  onToggleMyGames,
}: CommunityWorldDialogProps) {
  const [tab, setTab] = useState<DialogTab>('description')
  const [isShareNoticeOpen, setIsShareNoticeOpen] = useState(false)

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
  const isActionLocked = isLaunching || isRatingSaving || isMyGamesToggleSaving

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

  return (
    <BaseDialog
      open={open}
      onClose={() => {
        if (!isLaunching && !isRatingSaving && !isMyGamesToggleSaving) {
          setTab('description')
          setIsShareNoticeOpen(false)
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
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(186, 202, 214, 0.72) rgba(21, 26, 35, 0.7)',
          '&::-webkit-scrollbar': {
            width: 10,
          },
          '&::-webkit-scrollbar-track': {
            background: 'rgba(21, 26, 35, 0.7)',
            borderRadius: '999px',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(186, 202, 214, 0.72)',
            borderRadius: '999px',
            border: '1px solid rgba(49, 48, 46, 0.82)',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            background: 'rgba(204, 216, 232, 0.84)',
          },
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
                  backgroundImage: world.cover_image_url
                    ? `url(${world.cover_image_url})`
                    : `linear-gradient(150deg, hsla(${210 + (world.id % 20)}, 32%, 17%, 0.98) 0%, hsla(${220 + (world.id % 16)}, 36%, 11%, 0.99) 100%)`,
                  backgroundSize: world.cover_image_url ? `${Math.max(1, world.cover_scale || 1) * 100}%` : 'cover',
                  backgroundPosition: world.cover_image_url
                    ? `${world.cover_position_x || 50}% ${world.cover_position_y || 50}%`
                    : 'center',
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
                  <Stack spacing={BASE_GAP} alignItems="flex-start">
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: SUBHEADING_FONT_SIZE }}>
                      Раздел комментариев в разработке
                    </Typography>
                    <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem' }}>
                      Пока можно оценить мир, добавить его в Мои игры, поделиться ссылкой и запустить игру.
                    </Typography>
                    <Button
                      disabled
                      sx={{
                        minHeight: 0,
                        px: BASE_GAP,
                        py: BASE_GAP,
                        borderRadius: '12px',
                        textTransform: 'none',
                        border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                        backgroundColor: APP_CARD_BACKGROUND,
                        color: APP_TEXT_SECONDARY,
                      }}
                    >
                      Комментарии скоро
                    </Button>
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
                    <Stack direction="row" alignItems="center" spacing={1}>
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
            </Box>

            <Stack direction="row" justifyContent="flex-end" sx={{ px: BASE_GAP, pb: BASE_GAP }}>
              <Button
                onClick={() => {
                  setTab('description')
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
    </BaseDialog>
  )
}

export default CommunityWorldDialog
