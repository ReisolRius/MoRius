import { Box } from '@mui/material'

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
        aspectRatio: '0.78',
        opacity: showFavoriteButton ? 1 : 0.96,
      }}
    />
  )
}

export default CommunityWorldCardSkeleton
