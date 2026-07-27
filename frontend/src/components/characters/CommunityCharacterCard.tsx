import { Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import type { StoryCommunityCharacterSummary } from '../../types/story'
import ProgressiveAvatar from '../media/ProgressiveAvatar'
import CharacterShowcaseCard from './CharacterShowcaseCard'

type CommunityCharacterCardProps = {
  item: StoryCommunityCharacterSummary
  onClick: () => void
  disabled?: boolean
  actionSlot?: ReactNode
  minHeight?: number
}

function CommunityCharacterCard({
  item,
  onClick,
  disabled = false,
  actionSlot,
  minHeight = 420,
}: CommunityCharacterCardProps) {
  // Some legacy community records contain nulls despite the current API type.
  // Normalize server text at the card boundary so one old publication cannot
  // crash the whole profile page.
  const authorName = String(item.author_name ?? '').trim() || 'Неизвестный автор'
  const title = String(item.name ?? '').trim() || 'Без названия'
  const description = String(item.description ?? '').trim() || 'Описание не заполнено.'
  const note = String(item.note ?? '').trim()

  return (
    <CharacterShowcaseCard
      variant="community"
      title={title}
      description={description}
      imageUrl={item.avatar_url}
      imageScale={item.avatar_scale}
      eyebrow={note || null}
      heroHeader={(
        <Stack direction="row" spacing={0.8} alignItems="center" sx={{ minWidth: 0 }}>
          <ProgressiveAvatar
            src={item.author_avatar_url}
            fallbackLabel={authorName}
            size={30}
            frameId={item.author_avatar_frame_id}
            frameImageUrl={item.author_avatar_frame_image_url}
            sx={{
              flexShrink: 0,
              border: 'var(--morius-border-width) solid rgba(214, 225, 239, 0.28)',
              backgroundColor: 'rgba(6, 10, 16, 0.76)',
            }}
          />
          <Typography
            title={authorName}
            sx={{
              minWidth: 0,
              color: 'var(--morius-text-secondary)',
              fontSize: '0.82rem',
              fontWeight: 650,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {authorName}
          </Typography>
        </Stack>
      )}
      metaSecondary={`★ ${Math.max(0, item.community_rating_avg).toFixed(1)}`}
      actionSlot={actionSlot}
      onClick={onClick}
      disabled={disabled}
      minHeight={minHeight}
      descriptionLineClamp={3}
    />
  )
}

export default CommunityCharacterCard
