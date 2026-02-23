import { Box, Button, Container, Stack, Typography } from '@mui/material'
import { brandLogo } from '../assets'

type LegalDocumentPageProps = {
  title: string
  content: string
  onNavigate: (path: string, options?: { replace?: boolean }) => void
}

function LegalDocumentPage({ title, content, onNavigate }: LegalDocumentPageProps) {
  return (
    <Box
      sx={{
        minHeight: '100svh',
        background:
          'radial-gradient(circle at 68% 10%, rgba(130, 162, 192, 0.16) 0%, rgba(130, 162, 192, 0.04) 34%, transparent 55%), linear-gradient(180deg, #080c14 0%, #05070d 48%, #04060b 100%)',
        color: 'var(--morius-text-primary)',
        py: { xs: 4, md: 5 },
      }}
    >
      <Container maxWidth="md">
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ gap: 1 }}>
            <Box component="img" src={brandLogo} alt="Morius" sx={{ width: { xs: 112, md: 136 }, opacity: 0.9 }} />
            <Button
              onClick={() => onNavigate('/')}
              sx={{
                minHeight: 40,
                px: 1.5,
                borderRadius: '10px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-elevated-bg)',
                color: 'var(--morius-title-text)',
                textTransform: 'none',
                '&:hover': {
                  backgroundColor: 'var(--morius-button-hover)',
                },
              }}
            >
              На главную
            </Button>
          </Stack>

          <Box
            sx={{
              borderRadius: 'var(--morius-radius)',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              background: 'var(--morius-card-bg)',
              p: { xs: 1.4, md: 2 },
            }}
          >
            <Typography sx={{ fontSize: { xs: '1.55rem', md: '1.9rem' }, fontWeight: 800, mb: 1.5 }}>{title}</Typography>
            <Box
              component="pre"
              sx={{
                m: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'inherit',
                fontSize: { xs: '0.94rem', md: '1rem' },
                lineHeight: 1.58,
                color: 'var(--morius-text-primary)',
              }}
            >
              {content}
            </Box>
          </Box>
        </Stack>
      </Container>
    </Box>
  )
}

export default LegalDocumentPage
