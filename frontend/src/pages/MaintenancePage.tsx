import { Box, Stack, Typography } from '@mui/material'
import { brandLogo } from '../assets'
import heroBackground from '../assets/images/tavern-bg.webp'
import type { MaintenanceSettings } from '../services/authApi'

type MaintenancePageProps = {
  settings: MaintenanceSettings
}

function MaintenancePage({ settings }: MaintenancePageProps) {
  return (
    <Box
      className="morius-app-shell"
      sx={{
        position: 'relative',
        minHeight: '100dvh',
        overflow: 'hidden',
        backgroundColor: 'var(--morius-app-base)',
        color: 'var(--morius-text-primary)',
        display: 'grid',
        placeItems: 'center',
        px: { xs: 2, sm: 3 },
        py: { xs: 4, md: 6 },
        isolation: 'isolate',
      }}
    >
      <Box
        component="img"
        src={heroBackground}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center',
          opacity: 0.38,
          filter: 'saturate(0.92) contrast(1.06)',
          zIndex: -3,
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(135deg, rgba(5, 8, 14, 0.92) 0%, rgba(11, 17, 25, 0.78) 46%, rgba(39, 28, 18, 0.68) 100%)',
          zIndex: -2,
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: { xs: 16, md: 28 },
          borderRadius: { xs: '20px', md: '28px' },
          border: '1px solid rgba(216, 225, 238, 0.13)',
          boxShadow: 'inset 0 0 80px rgba(214, 157, 86, 0.06)',
          pointerEvents: 'none',
          zIndex: -1,
        }}
      />

      <Stack
        spacing={{ xs: 2.2, md: 2.6 }}
        alignItems="center"
        sx={{
          width: 'min(100%, 760px)',
          textAlign: 'center',
          px: { xs: 0.5, sm: 2 },
          animation: 'morius-fade-up 520ms ease both',
        }}
      >
        <Box
          component="img"
          src={brandLogo}
          alt="MoRius"
          sx={{
            width: { xs: 112, sm: 132 },
            height: 'auto',
            opacity: 0.98,
            filter: 'brightness(0) invert(1)',
            mb: { xs: 0.4, md: 0.7 },
          }}
        />

        <Box
          sx={{
            px: 1.1,
            py: 0.42,
            borderRadius: '999px',
            border: '1px solid rgba(225, 236, 249, 0.16)',
            backgroundColor: 'rgba(17, 25, 35, 0.54)',
            color: 'rgba(229, 238, 249, 0.78)',
            fontSize: { xs: '0.78rem', sm: '0.84rem' },
            fontWeight: 800,
            lineHeight: 1.25,
            textTransform: 'uppercase',
          }}
        >
          Технические работы
        </Box>

        <Typography
          component="h1"
          sx={{
            color: 'var(--morius-title-text)',
            fontSize: { xs: '2rem', sm: '2.8rem', md: '3.35rem' },
            fontWeight: 900,
            lineHeight: 1.04,
            maxWidth: 720,
            overflowWrap: 'anywhere',
          }}
        >
          {settings.title}
        </Typography>

        <Typography
          sx={{
            color: 'rgba(229, 238, 249, 0.8)',
            fontSize: { xs: '1rem', sm: '1.12rem' },
            lineHeight: 1.7,
            maxWidth: 640,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {settings.message}
        </Typography>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={{ xs: 1, sm: 1.2 }}
          alignItems="center"
          justifyContent="center"
          sx={{ pt: { xs: 0.2, md: 0.6 }, width: '100%' }}
        >
          <Box
            sx={{
              minHeight: 44,
              px: 1.45,
              py: 0.85,
              borderRadius: '12px',
              border: '1px solid rgba(224, 236, 250, 0.18)',
              backgroundColor: 'rgba(12, 18, 26, 0.58)',
              color: 'rgba(244, 248, 255, 0.92)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: { xs: '0.92rem', sm: '0.96rem' },
              fontWeight: 800,
              lineHeight: 1.35,
              maxWidth: '100%',
              overflowWrap: 'anywhere',
            }}
          >
            {settings.eta_label}
          </Box>
          <Typography sx={{ color: 'rgba(229, 238, 249, 0.58)', fontSize: '0.9rem', lineHeight: 1.45 }}>
            Обновите страницу позже
          </Typography>
        </Stack>
      </Stack>
    </Box>
  )
}

export default MaintenancePage
