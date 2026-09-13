import { Box } from '@mui/material'

import { GAME_COVER_ASPECT } from '../../constants/gameCover'

type CommunityWorldCardSkeletonProps = {
  showFavoriteButton?: boolean
}

function CommunityWorldCardSkeleton({ showFavoriteButton = false }: CommunityWorldCardSkeletonProps) {
  return (
    <Box
      className="morius-skeleton-card"
      sx={{
        height: '100%',
        minHeight: 300,
        width: '100%',
        // Cover at the card ratio plus the fixed copy block underneath it, so the skeleton
        // occupies the same box the loaded card will.
        aspectRatio: `1 / ${(1 / GAME_COVER_ASPECT + 0.62).toFixed(3)}`,
        opacity: showFavoriteButton ? 1 : 0.96,
      }}
    />
  )
}

export default CommunityWorldCardSkeleton
