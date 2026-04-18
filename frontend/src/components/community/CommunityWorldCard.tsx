import { Box, CircularProgress, IconButton, Stack, SvgIcon, Typography } from '@mui/material'
import type { SxProps } from '@mui/system'
import type { Theme } from '@mui/material/styles'
import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { icons } from '../../assets'
import ProgressiveAvatar from '../media/ProgressiveAvatar'
import { useVisibilityTrigger } from '../../hooks/useVisibilityTrigger'
import { resolveApiResourceUrl } from '../../services/httpClient'
import type { StoryCommunityWorldSummary } from '../../types/story'
import { buildWorldFallbackArtwork } from '../../utils/worldBackground'

type CommunityWorldCardProps = {
  world: StoryCommunityWorldSummary
  onClick: () => void
  onAuthorClick?: (authorId: number) => void
  disabled?: boolean
  sx?: SxProps<Theme>
  showFavoriteButton?: boolean
  isFavoriteSaving?: boolean
  onToggleFavorite?: (world: StoryCommunityWorldSummary) => void
  coverBadge?: ReactNode
}

const CARD_BACKGROUND = 'var(--morius-card-bg)'
const CARD_BORDER = 'var(--morius-card-border)'
const TEXT_PRIMARY = 'var(--morius-text-primary)'
const TEXT_SECONDARY = 'var(--morius-text-secondary)'
const TITLE_LINE_HEIGHT = 1.2
const TITLE_LINE_COUNT = 1
const DESCRIPTION_LINE_HEIGHT = 1.45
const DESCRIPTION_LINE_COUNT = 2
const COVER_IMAGE_LOAD_TIMEOUT_MS = 8000

function formatWorldCreatedAtLabel(isoDate: string): string {
  const parsedDate = new Date(isoDate)
  if (Number.isNaN(parsedDate.getTime())) {
    return 'Unknown date'
  }
  return parsedDate.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
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

function FavoriteHeartIcon({ active }: { active: boolean }) {
  return (
    <SvgIcon sx={{ width: 18, height: 18, color: active ? 'rgba(245, 138, 161, 0.96)' : 'rgba(220, 231, 245, 0.9)' }}>
      <path d="M12.001 21.35l-1.45-1.32C5.401 15.36 2.001 12.28 2.001 8.5c0-3.03 2.42-5.5 5.5-5.5 1.74 0 3.41.81 4.5 2.09 1.09-1.28 2.76-2.09 4.5-2.09 3.08 0 5.5 2.47 5.5 5.5 0 3.78-3.4 6.86-8.55 11.53l-1.45 1.32z" />
    </SvgIcon>
  )
}

function CommunityWorldCard({
  world,
  onClick,
  onAuthorClick,
  disabled = false,
  sx,
  showFavoriteButton = false,
  isFavoriteSaving = false,
  onToggleFavorite,
  coverBadge,
}: CommunityWorldCardProps) {
  const authorName = world.author_name.trim() || 'Unknown author'
  const authorAvatarUrl = resolveApiResourceUrl(world.author_avatar_url)
  const coverImageUrl = resolveApiResourceUrl(world.cover_image_url)
  const authorInitials = resolveAuthorInitials(authorName)
  const { ref: coverRef, isVisible: isCoverVisible } = useVisibilityTrigger<HTMLDivElement>({
    rootMargin: '120px 0px',
    disabled: !coverImageUrl,
  })
  const [isCoverLoaded, setIsCoverLoaded] = useState(false)
  const [isCoverFailed, setIsCoverFailed] = useState(false)

  useEffect(() => {
    setIsCoverLoaded(false)
    setIsCoverFailed(false)
  }, [coverImageUrl, world.id])

  useEffect(() => {
    if (!isCoverVisible || !coverImageUrl || isCoverLoaded || isCoverFailed) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setIsCoverFailed((currentValue) => (isCoverLoaded ? currentValue : true))
    }, COVER_IMAGE_LOAD_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [coverImageUrl, isCoverFailed, isCoverLoaded, isCoverVisible])

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }

  const handleFavoriteToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (disabled || isFavoriteSaving || !onToggleFavorite) {
      return
    }
    onToggleFavorite(world)
  }

  const handleAuthorClick = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled || !onAuthorClick) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onAuthorClick(world.author_id)
  }

  const handleAuthorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !onAuthorClick) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      onAuthorClick(world.author_id)
    }
  }

  return (
    <Box
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onClick()
        }
      }}
      onKeyDown={handleCardKeyDown}
      sx={[
        {
          p: 0,
          borderRadius: 'var(--morius-radius)',
          border: `var(--morius-border-width) solid ${CARD_BORDER}`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          textAlign: 'left',
          alignItems: 'stretch',
          justifyContent: 'flex-start',
          background: CARD_BACKGROUND,
          color: TEXT_PRIMARY,
          height: '100%',
          width: '100%',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.82 : 1,
          transition: 'transform 180ms ease, border-color 180ms ease',
          '& .community-world-card-favorite': {
            opacity: { xs: 1, md: 0 },
            transform: { xs: 'translateY(0)', md: 'translateY(-4px)' },
            pointerEvents: { xs: 'auto', md: 'none' },
            transition: 'opacity 180ms ease, transform 180ms ease, background-color 180ms ease',
          },
          '&:hover': disabled
            ? undefined
            : {
                borderColor: 'rgba(203, 216, 234, 0.36)',
                transform: 'translateY(-2px)',
              },
          '&:hover .community-world-card-favorite, &:focus-within .community-world-card-favorite': {
            opacity: 1,
            transform: 'translateY(0)',
            pointerEvents: 'auto',
          },
          '&:focus-visible': {
            outline: '2px solid rgba(205, 223, 246, 0.62)',
            outlineOffset: '2px',
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Box
        ref={coverRef}
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: '3 / 2',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {coverImageUrl && !isCoverFailed ? (
          <>
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                ...buildWorldFallbackArtwork(world.id),
              }}
            />
            {isCoverVisible && !isCoverLoaded ? (
              <Box
                aria-hidden
                sx={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 1,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <CircularProgress size={30} thickness={4} sx={{ color: 'rgba(225, 234, 244, 0.9)' }} />
              </Box>
            ) : null}
            {isCoverVisible ? (
              <Box
                component="img"
                src={coverImageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                fetchPriority="low"
                onLoad={() => setIsCoverLoaded(true)}
                onError={() => {
                  setIsCoverFailed(true)
                  setIsCoverLoaded(false)
                }}
                sx={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  display: 'block',
                  objectFit: 'cover',
                  objectPosition: `${world.cover_position_x || 50}% ${world.cover_position_y || 50}%`,
                  opacity: isCoverLoaded ? 1 : 0,
                  transition: 'opacity 220ms ease',
                }}
              />
            ) : null}
          </>
        ) : (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              ...buildWorldFallbackArtwork(world.id),
            }}
          />
        )}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(5, 8, 12, 0.2) 0%, rgba(5, 8, 12, 0.1) 34%, rgba(5, 8, 12, 0.03) 100%)',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: { xs: '108px', md: '122px' },
            background:
              'linear-gradient(180deg, rgba(3, 6, 10, 0.94) 0%, rgba(3, 6, 10, 0.72) 34%, rgba(3, 6, 10, 0.34) 68%, rgba(3, 6, 10, 0) 100%)',
          }}
        />
        <Stack
          direction="row"
          alignItems="center"
          spacing="20px"
          role={onAuthorClick && !disabled ? 'button' : undefined}
          tabIndex={onAuthorClick && !disabled ? 0 : undefined}
          onClick={handleAuthorClick}
          onKeyDown={handleAuthorKeyDown}
          sx={{
            position: 'absolute',
            top: { xs: '12px', md: '14px' },
            left: { xs: '12px', md: '14px' },
            right: { xs: '12px', md: '14px' },
            minWidth: 0,
            pr: showFavoriteButton ? '44px' : 0,
            cursor: onAuthorClick && !disabled ? 'pointer' : 'default',
            '&:focus-visible': onAuthorClick && !disabled
              ? {
                  outline: '2px solid rgba(205, 223, 246, 0.62)',
                  outlineOffset: '2px',
                  borderRadius: '8px',
                }
              : undefined,
          }}
        >
          <ProgressiveAvatar
            src={authorAvatarUrl}
            alt={authorName}
            fallbackLabel={authorInitials}
            size={40}
            sx={{
              border: 'var(--morius-border-width) solid rgba(205, 220, 242, 0.32)',
              background: 'linear-gradient(180deg, rgba(47, 62, 86, 0.78), rgba(22, 31, 44, 0.9))',
            }}
          />
          <Typography
            sx={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'rgba(233, 241, 252, 0.97)',
              fontSize: { xs: '0.88rem', md: '0.93rem' },
              lineHeight: 1.2,
              fontWeight: 700,
            }}
            title={authorName}
          >
            {authorName}
          </Typography>
        </Stack>

        {showFavoriteButton ? (
          <IconButton
            className="community-world-card-favorite"
            aria-label={world.is_favorited_by_user ? 'Убрать из любимых миров' : 'Добавить в любимые миры'}
            onClick={handleFavoriteToggle}
            disabled={disabled || isFavoriteSaving || !onToggleFavorite}
            sx={{
              position: 'absolute',
              top: 10,
              right: 10,
              zIndex: 3,
              width: 32,
              height: 32,
              borderRadius: '999px',
              border: 'none',
              backgroundColor: 'rgba(5, 8, 13, 0.64)',
              '&:hover': {
                backgroundColor: 'rgba(17, 27, 40, 0.78)',
              },
              '&:disabled': {
                opacity: 0.62,
              },
            }}
          >
            <FavoriteHeartIcon active={world.is_favorited_by_user} />
          </IconButton>
        ) : null}

        {coverBadge ? (
          <Box
            sx={{
              position: 'absolute',
              left: { xs: '12px', md: '14px' },
              bottom: { xs: '12px', md: '14px' },
              zIndex: 2,
              maxWidth: 'calc(100% - 28px)',
              pointerEvents: 'none',
            }}
          >
            {coverBadge}
          </Box>
        ) : null}
      </Box>

      <Box
        sx={{
          width: '100%',
          px: { xs: '16px', md: '20px' },
          pt: { xs: '16px', md: '20px' },
          pb: { xs: '16px', md: '20px' },
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          background: CARD_BACKGROUND,
        }}
      >
        <Typography
          sx={{
            color: TEXT_PRIMARY,
            fontSize: { xs: '18px', md: '20px' },
            lineHeight: TITLE_LINE_HEIGHT,
            fontWeight: 700,
            minHeight: `${TITLE_LINE_HEIGHT * TITLE_LINE_COUNT}em`,
            maxHeight: `${TITLE_LINE_HEIGHT * TITLE_LINE_COUNT}em`,
            display: '-webkit-box',
            WebkitLineClamp: TITLE_LINE_COUNT,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={world.title}
        >
          {world.title}
        </Typography>

        <Typography
          sx={{
            mt: '8px',
            color: TEXT_SECONDARY,
            fontSize: { xs: '15px', md: '16px' },
            lineHeight: DESCRIPTION_LINE_HEIGHT,
            minHeight: `${DESCRIPTION_LINE_HEIGHT * DESCRIPTION_LINE_COUNT}em`,
            maxHeight: `${DESCRIPTION_LINE_HEIGHT * DESCRIPTION_LINE_COUNT}em`,
            display: '-webkit-box',
            WebkitLineClamp: DESCRIPTION_LINE_COUNT,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={world.description}
        >
          {world.description}
        </Typography>

        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            mt: '14px',
            minWidth: 0,
          }}
        >
          <Typography
            sx={{
              color: TEXT_SECONDARY,
              fontSize: { xs: '13px', md: '14px' },
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              pr: 1.2,
            }}
            title={formatWorldCreatedAtLabel(world.created_at)}
          >
            {formatWorldCreatedAtLabel(world.created_at)}
          </Typography>

          <Stack direction="row" alignItems="center" spacing="10px" sx={{ flexShrink: 0 }}>
            <Stack direction="row" alignItems="center" spacing="10px">
              <Typography sx={{ color: TEXT_PRIMARY, fontSize: { xs: '13px', md: '14px' }, fontWeight: 600, lineHeight: 1 }}>
                {world.community_launches}
              </Typography>
              <Box component="img" src={icons.communityPlay} alt="" sx={{ width: 14, height: 14, opacity: 0.9 }} />
            </Stack>
            <Stack direction="row" alignItems="center" spacing="6px">
              <Typography sx={{ color: TEXT_PRIMARY, fontSize: { xs: '13px', md: '14px' }, fontWeight: 600, lineHeight: 1 }}>
                {world.community_rating_avg.toFixed(1)}
              </Typography>
              <Typography
                sx={{
                  color: TEXT_PRIMARY,
                  fontSize: '20px',
                  fontWeight: 600,
                  lineHeight: '20px',
                  width: 20,
                  height: 20,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {String.fromCharCode(9733)}
              </Typography>
            </Stack>
          </Stack>
        </Stack>
      </Box>
    </Box>
  )
}

export default CommunityWorldCard
