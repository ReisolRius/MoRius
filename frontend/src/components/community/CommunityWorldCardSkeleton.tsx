import { Box, Skeleton, Stack } from '@mui/material'

type CommunityWorldCardSkeletonProps = {
  showFavoriteButton?: boolean
}

function CommunityWorldCardSkeleton({ showFavoriteButton = false }: CommunityWorldCardSkeletonProps) {
  return (
    <Box
      sx={{
        p: 0,
        borderRadius: 'var(--morius-radius)',
        border: 'var(--morius-border-width) solid var(--morius-card-border)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        background: 'var(--morius-card-bg)',
        height: '100%',
        width: '100%',
      }}
    >
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: '3 / 2',
          flexShrink: 0,
          overflow: 'hidden',
          background:
            'linear-gradient(150deg, rgba(35, 46, 64, 0.82) 0%, rgba(19, 26, 38, 0.9) 58%, rgba(11, 16, 25, 0.94) 100%)',
        }}
      >
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
            pr: showFavoriteButton ? '44px' : 0,
          }}
        >
          <Skeleton variant="circular" width={40} height={40} sx={{ bgcolor: 'rgba(184, 201, 226, 0.22)' }} />
          <Skeleton variant="text" width="38%" height={24} sx={{ bgcolor: 'rgba(184, 201, 226, 0.22)' }} />
        </Stack>

        {showFavoriteButton ? (
          <Skeleton
            variant="circular"
            width={32}
            height={32}
            sx={{
              position: 'absolute',
              top: 10,
              right: 10,
              bgcolor: 'rgba(184, 201, 226, 0.2)',
            }}
          />
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
          background: 'var(--morius-card-bg)',
        }}
      >
        <Skeleton variant="text" width="74%" height={34} sx={{ bgcolor: 'rgba(184, 201, 226, 0.2)' }} />
        <Stack spacing={0.7} sx={{ mt: 0.6 }}>
          <Skeleton variant="text" width="95%" height={24} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
          <Skeleton variant="text" width="90%" height={24} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
          <Skeleton variant="text" width="70%" height={24} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
        </Stack>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: '20px' }}>
          <Skeleton variant="text" width="36%" height={22} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
          <Skeleton variant="text" width={80} height={22} sx={{ bgcolor: 'rgba(184, 201, 226, 0.18)' }} />
        </Stack>
      </Box>
    </Box>
  )
}

export default CommunityWorldCardSkeleton
