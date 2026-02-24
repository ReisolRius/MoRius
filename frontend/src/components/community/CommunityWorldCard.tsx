import { Box, Button, Stack, Typography } from '@mui/material'
import type { SxProps } from '@mui/system'
import type { Theme } from '@mui/material/styles'
import { icons } from '../../assets'
import type { StoryCommunityWorldSummary } from '../../types/story'

type CommunityWorldCardProps = {
  world: StoryCommunityWorldSummary
  onClick: () => void
  disabled?: boolean
  sx?: SxProps<Theme>
}

const CARD_BACKGROUND = 'var(--morius-card-bg)'
const CARD_BORDER = 'var(--morius-card-border)'
const TEXT_PRIMARY = 'var(--morius-text-primary)'
const TEXT_SECONDARY = 'var(--morius-text-secondary)'
const DESCRIPTION_LINE_HEIGHT = 1.5
const DESCRIPTION_LINE_COUNT = 3

function buildFallbackArtwork(worldId: number): string {
  return `linear-gradient(150deg, hsla(${210 + (worldId % 20)}, 32%, 17%, 0.98) 0%, hsla(${220 + (worldId % 16)}, 36%, 11%, 0.99) 100%)`
}

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

function CommunityWorldCard({ world, onClick, disabled = false, sx }: CommunityWorldCardProps) {
  const authorName = world.author_name.trim() || 'Unknown author'
  const authorAvatarUrl = world.author_avatar_url
  const authorInitials = resolveAuthorInitials(authorName)

  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      sx={[
        {
          p: 0,
          borderRadius: 'var(--morius-radius)',
          border: `var(--morius-border-width) solid ${CARD_BORDER}`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          textTransform: 'none',
          textAlign: 'left',
          alignItems: 'stretch',
          justifyContent: 'flex-start',
          background: CARD_BACKGROUND,
          color: TEXT_PRIMARY,
          height: '100%',
          width: '100%',
          transition: 'transform 180ms ease, border-color 180ms ease',
          '&:hover': {
            borderColor: 'rgba(203, 216, 234, 0.36)',
            transform: 'translateY(-2px)',
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: '4 / 3',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage: world.cover_image_url ? `url(${world.cover_image_url})` : buildFallbackArtwork(world.id),
            backgroundSize: world.cover_image_url ? `${Math.max(1, world.cover_scale || 1) * 100}% auto` : 'cover',
            backgroundPosition: world.cover_image_url
              ? `${world.cover_position_x || 50}% ${world.cover_position_y || 50}%`
              : 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
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
          sx={{
            position: 'absolute',
            top: { xs: '12px', md: '14px' },
            left: { xs: '12px', md: '14px' },
            right: { xs: '12px', md: '14px' },
            minWidth: 0,
          }}
        >
          <Box
            sx={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              overflow: 'hidden',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              fontSize: '0.84rem',
              fontWeight: 800,
              color: 'rgba(229, 238, 250, 0.96)',
              border: 'var(--morius-border-width) solid rgba(205, 220, 242, 0.32)',
              background: 'linear-gradient(180deg, rgba(47, 62, 86, 0.78), rgba(22, 31, 44, 0.9))',
            }}
          >
            {authorAvatarUrl ? (
              <Box component="img" src={authorAvatarUrl} alt={authorName} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              authorInitials
            )}
          </Box>
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
            lineHeight: 1.2,
            fontWeight: 700,
            display: '-webkit-box',
            WebkitLineClamp: 2,
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
            mt: '10px',
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
            mt: '20px',
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
    </Button>
  )
}

export default CommunityWorldCard


