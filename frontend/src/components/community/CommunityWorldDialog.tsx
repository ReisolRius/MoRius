import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
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

type CommunityPreviewBadgeTone = 'green' | 'blue'
type DialogTab = 'description' | 'comments'

type CommunityWorldDialogProps = {
  open: boolean
  isLoading: boolean
  worldPayload: StoryCommunityWorldPayload | null
  ratingDraft: number
  isRatingSaving: boolean
  isLaunching: boolean
  onClose: () => void
  onPlay: () => void
  onChangeRating: (value: number) => void
  onSaveRating: () => void
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
        minHeight: 186,
        borderRadius: 'var(--morius-radius)',
        border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
        background: 'var(--morius-elevated-bg)',
        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.24)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ px: 1.1, py: 0.85, borderBottom: 'var(--morius-border-width) solid var(--morius-card-border)', background: 'var(--morius-card-bg)' }}>
        <Stack direction="row" spacing={0.7} alignItems="center">
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
              fontSize: '0.86rem',
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
              fontSize: '0.63rem',
              lineHeight: 1,
              letterSpacing: 0.22,
              textTransform: 'uppercase',
              fontWeight: 700,
              border: `var(--morius-border-width) solid ${badgeBorder}`,
              borderRadius: '999px',
              px: 0.58,
              py: 0.18,
              flexShrink: 0,
            }}
          >
            {badge}
          </Typography>
        </Stack>
      </Box>
      <Box sx={{ px: 1.1, py: 0.9, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Typography
          sx={{
            color: 'rgba(208, 219, 235, 0.88)',
            fontSize: '0.86rem',
            lineHeight: 1.4,
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
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.2}>
      <Stack direction="row" alignItems="center" spacing={0.7} sx={{ minWidth: 0 }}>
        <Box component="img" src={iconSrc} alt="" sx={{ width: 16, height: 16, opacity: 0.88, flexShrink: 0 }} />
        <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </Typography>
      </Stack>
      <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '0.92rem', fontWeight: 700, textAlign: 'right' }}>{value}</Typography>
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
  onClose,
  onPlay,
  onChangeRating,
  onSaveRating,
}: CommunityWorldDialogProps) {
  const [tab, setTab] = useState<DialogTab>('description')

  const world = worldPayload?.world ?? null
  const cardsCount = useMemo(() => {
    if (!worldPayload) {
      return 0
    }
    return worldPayload.instruction_cards.length + worldPayload.plot_cards.length + worldPayload.world_cards.length
  }, [worldPayload])

  return (
    <BaseDialog
      open={open}
      onClose={() => {
        if (!isLaunching && !isRatingSaving) {
          setTab('description')
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
      }}
      rawChildren
    >
      <Box sx={{ p: { xs: 1.2, md: 1.6 } }}>
        {isLoading || !world || !worldPayload ? (
          <Stack alignItems="center" justifyContent="center" sx={{ py: 6 }}>
            <CircularProgress size={30} />
          </Stack>
        ) : (
          <Stack spacing={1.2}>
            <Box
              sx={{
                position: 'relative',
                minHeight: { xs: 180, md: 300 },
                borderRadius: 'var(--morius-radius)',
                overflow: 'hidden',
                border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                backgroundImage: world.cover_image_url
                  ? `url(${world.cover_image_url})`
                  : `linear-gradient(150deg, hsla(${210 + (world.id % 20)}, 32%, 17%, 0.98) 0%, hsla(${220 + (world.id % 16)}, 36%, 11%, 0.99) 100%)`,
                backgroundSize: world.cover_image_url ? `${Math.max(1, world.cover_scale || 1) * 100}%` : 'cover',
                backgroundPosition: world.cover_image_url
                  ? `${world.cover_position_x || 50}% ${world.cover_position_y || 50}%`
                  : 'center',
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(180deg, rgba(6, 9, 14, 0.1) 0%, rgba(6, 9, 14, 0.4) 60%, rgba(6, 9, 14, 0.86) 100%)',
                }}
              />
              <Box
                sx={{
                  position: 'absolute',
                  left: 12,
                  right: 12,
                  bottom: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  width: 'fit-content',
                  maxWidth: 'calc(100% - 24px)',
                  borderRadius: 1.2,
                  px: 1.2,
                  py: 0.55,
                  background: 'rgba(14, 18, 26, 0.74)',
                  backdropFilter: 'blur(4px)',
                  WebkitBackdropFilter: 'blur(4px)',
                }}
              >
                <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 800, fontSize: { xs: '1.24rem', md: '1.85rem' }, lineHeight: 1.2 }}>
                  {world.title}
                </Typography>
              </Box>
            </Box>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }}>
              <Box
                sx={{
                  borderRadius: 'var(--morius-radius)',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  backgroundColor: 'var(--morius-elevated-bg)',
                  px: 1.05,
                  py: 0.8,
                }}
              >
                <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <Button
                      key={value}
                      onClick={() => onChangeRating(value)}
                      disabled={isRatingSaving || isLaunching}
                      sx={{
                        minWidth: 34,
                        minHeight: 34,
                        p: 0,
                        borderRadius: '10px',
                        border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                        backgroundColor: value <= ratingDraft ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                        color: APP_TEXT_PRIMARY,
                        fontSize: '0.98rem',
                        lineHeight: 1,
                      }}
                    >
                      {value <= ratingDraft ? '★' : '☆'}
                    </Button>
                  ))}
                  <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: '1.02rem', ml: 0.45 }}>
                    {world.community_rating_avg.toFixed(1)}
                  </Typography>
                  <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.84rem' }}>
                    ({world.community_rating_count})
                  </Typography>
                  <Button
                    onClick={() => void onSaveRating()}
                    disabled={ratingDraft < 1 || isRatingSaving || isLaunching}
                    sx={{
                      minHeight: 34,
                      px: 1.05,
                      borderRadius: '10px',
                      textTransform: 'none',
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: APP_BUTTON_ACTIVE,
                      color: APP_TEXT_PRIMARY,
                      '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                    }}
                  >
                    {isRatingSaving ? <CircularProgress size={14} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Сохранить'}
                  </Button>
                </Stack>
              </Box>

              <Button
                onClick={onPlay}
                disabled={isLaunching || isLoading}
                sx={{
                  minWidth: 164,
                  minHeight: 44,
                  borderRadius: 'var(--morius-radius)',
                  textTransform: 'none',
                  fontWeight: 700,
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  backgroundColor: APP_BUTTON_ACTIVE,
                  color: APP_TEXT_PRIMARY,
                  '&:hover': {
                    backgroundColor: APP_BUTTON_HOVER,
                  },
                }}
              >
                {isLaunching ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Играть'}
              </Button>
            </Stack>

            <Stack direction="row" spacing={0.8} flexWrap="wrap">
              <Button
                onClick={() => setTab('description')}
                sx={{
                  minHeight: 40,
                  px: 1.3,
                  borderRadius: 'var(--morius-radius)',
                  textTransform: 'none',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  backgroundColor: tab === 'description' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                  color: APP_TEXT_PRIMARY,
                  '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                }}
              >
                <Stack direction="row" spacing={0.6} alignItems="center">
                  <Box component="img" src={icons.communityInfo} alt="" sx={{ width: 15, height: 15, opacity: 0.9 }} />
                  <span>Описание</span>
                </Stack>
              </Button>
              <Button
                onClick={() => setTab('comments')}
                sx={{
                  minHeight: 40,
                  px: 1.3,
                  borderRadius: 'var(--morius-radius)',
                  textTransform: 'none',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  backgroundColor: tab === 'comments' ? APP_BUTTON_ACTIVE : APP_CARD_BACKGROUND,
                  color: APP_TEXT_PRIMARY,
                  '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                }}
              >
                <Stack direction="row" spacing={0.6} alignItems="center">
                  <Box component="img" src={icons.communityComments} alt="" sx={{ width: 15, height: 15, opacity: 0.9 }} />
                  <span>Комментарии</span>
                </Stack>
              </Button>
            </Stack>

            {tab === 'comments' ? (
              <Box
                sx={{
                  borderRadius: 'var(--morius-radius)',
                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                  backgroundColor: 'var(--morius-elevated-bg)',
                  p: 1.35,
                }}
              >
                <Stack spacing={0.8} alignItems="flex-start">
                  <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: '1rem' }}>
                    Раздел комментариев в разработке
                  </Typography>
                  <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.92rem' }}>
                    Пока можно оценить мир и запустить игру. Комментарии появятся в одном из следующих обновлений.
                  </Typography>
                  <Button
                    disabled
                    sx={{
                      minHeight: 36,
                      px: 1.15,
                      borderRadius: 'var(--morius-radius)',
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
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gap: 1.35,
                  gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 320px' },
                  alignItems: 'start',
                }}
              >
                <Stack spacing={1}>
                  <Stack direction="row" alignItems="center" spacing={0.7}>
                    <Box
                      sx={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                        display: 'grid',
                        placeItems: 'center',
                        color: APP_TEXT_PRIMARY,
                        fontWeight: 800,
                        fontSize: '0.8rem',
                        background: APP_CARD_BACKGROUND,
                      }}
                    >
                      {world.author_name.trim().charAt(0).toUpperCase() || 'A'}
                    </Box>
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1rem', fontWeight: 700 }}>
                      {world.author_name}
                    </Typography>
                  </Stack>

                  <Stack spacing={0.5}>
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.28rem', fontWeight: 700 }}>Описание</Typography>
                    <Typography
                      sx={{
                        color: APP_TEXT_SECONDARY,
                        fontSize: '0.96rem',
                        lineHeight: 1.56,
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                      }}
                    >
                      {world.description || 'Описание мира пока отсутствует.'}
                    </Typography>
                  </Stack>

                  <Stack spacing={0.6}>
                    <Typography sx={{ fontWeight: 700 }}>Карточки инструкций</Typography>
                    {worldPayload.instruction_cards.length === 0 ? (
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>Нет карточек инструкций.</Typography>
                    ) : (
                      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
                        {worldPayload.instruction_cards.map((card) => (
                          <CommunityPreviewCard key={card.id} title={card.title} content={card.content} badge="ИНСТРУКЦИЯ" />
                        ))}
                      </Box>
                    )}
                  </Stack>

                  <Stack spacing={0.6}>
                    <Typography sx={{ fontWeight: 700 }}>Карточки сюжета</Typography>
                    {worldPayload.plot_cards.length === 0 ? (
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>Нет карточек сюжета.</Typography>
                    ) : (
                      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
                        {worldPayload.plot_cards.map((card) => (
                          <CommunityPreviewCard key={card.id} title={card.title} content={card.content} badge="СЮЖЕТ" />
                        ))}
                      </Box>
                    )}
                  </Stack>

                  <Stack spacing={0.6}>
                    <Typography sx={{ fontWeight: 700 }}>Карточки мира и персонажей</Typography>
                    {worldPayload.world_cards.length === 0 ? (
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.9rem' }}>Нет карточек мира.</Typography>
                    ) : (
                      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
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

                <Stack spacing={0.7}>
                  <Typography sx={{ color: APP_TEXT_PRIMARY, fontWeight: 700, fontSize: '1.22rem' }}>Подробнее</Typography>
                  <Box
                    sx={{
                      borderRadius: 'var(--morius-radius)',
                      border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                      backgroundColor: 'var(--morius-elevated-bg)',
                      p: 1.05,
                    }}
                  >
                    <Stack spacing={0.9}>
                      <DetailRow iconSrc={icons.communityPlay} label="Игр проведено" value={formatCompactCount(world.community_launches)} />
                      <DetailRow iconSrc={icons.communityEdit} label="Создано" value={formatDateLabel(world.created_at)} />
                      <DetailRow iconSrc={icons.reload} label="Обновлено" value={formatDateLabel(world.updated_at)} />
                      <DetailRow iconSrc={icons.world} label="Готовые карточки" value={`${cardsCount} шт`} />
                      <DetailRow iconSrc={icons.communityAge} label="Возраст" value={world.age_rating} />
                      <Stack spacing={0.35}>
                        <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.88rem', fontWeight: 700 }}>Жанры</Typography>
                        {world.genres.length === 0 ? (
                          <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.86rem' }}>Не указаны</Typography>
                        ) : (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.45 }}>
                            {world.genres.map((genre) => (
                              <Box
                                key={genre}
                                sx={{
                                  px: 0.7,
                                  py: 0.24,
                                  borderRadius: '999px',
                                  border: `var(--morius-border-width) solid ${APP_BORDER_COLOR}`,
                                  backgroundColor: APP_CARD_BACKGROUND,
                                  color: APP_TEXT_PRIMARY,
                                  fontSize: '0.76rem',
                                }}
                              >
                                {genre}
                              </Box>
                            ))}
                          </Box>
                        )}
                      </Stack>
                    </Stack>
                  </Box>
                </Stack>
              </Box>
            )}

            <Stack direction="row" justifyContent="flex-end">
              <Button
                onClick={() => {
                  setTab('description')
                  onClose()
                }}
                sx={{ color: APP_TEXT_SECONDARY }}
                disabled={isLaunching || isRatingSaving}
              >
                Закрыть
              </Button>
            </Stack>
          </Stack>
        )}
      </Box>
    </BaseDialog>
  )
}

export default CommunityWorldDialog
