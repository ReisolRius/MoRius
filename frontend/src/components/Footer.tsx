import { type ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'

export interface FooterLink {
  label: string
  href?: string
  path?: string
  external?: boolean
}

export interface FooterProps {
  socialLinks?: FooterLink[]
  infoLinks?: FooterLink[]
  onNavigate?: (path: string) => void
}

export default function Footer({ socialLinks = [], infoLinks = [], onNavigate }: FooterProps) {
  const FOOTER_CREDIT_TEXT = 'Бондарук Александр Георгиевич | ИНН: 772702320496 | ОГРНИП: 325774600487692 | Почта: alexunderstood8@gmail.com'
  const FOOTER_PROJECT_DESCRIPTION = 'Текстовое приключение, где ИИ ведёт игру, а ты решаешь, кем стать и как закончится история'

  const renderLink = (link: FooterLink, isExternalUrl: boolean): ReactNode => {
    const linkContent = (
      <Typography
        sx={{
          color: 'var(--morius-text-secondary)',
          textDecoration: 'none',
          fontSize: '16px',
          fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
          fontWeight: 400,
          transition: 'color 180ms ease',
          '&:hover': { color: 'var(--morius-title-text)' },
        }}
      >
        {link.label}
      </Typography>
    )

    if (isExternalUrl && link.href) {
      return (
        <Typography
          key={link.label}
          component="a"
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            color: 'var(--morius-text-secondary)',
            textDecoration: 'none',
            fontSize: '16px',
            fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
            fontWeight: 400,
            transition: 'color 180ms ease',
            display: 'inline-block',
            '&:hover': { color: 'var(--morius-title-text)' },
          }}
        >
          {link.label}
        </Typography>
      )
    }

    if (link.path && onNavigate) {
      return (
        <Box
          key={link.label}
          component="button"
          type="button"
          onClick={() => onNavigate(link.path!)}
          sx={{
            p: 0,
            m: 0,
            border: 'none',
            background: 'none',
            color: 'var(--morius-text-secondary)',
            textAlign: 'left',
            font: 'inherit',
            fontSize: '16px',
            fontWeight: 400,
            fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
            cursor: 'pointer',
            transition: 'color 180ms ease',
            '&:hover': { color: 'var(--morius-title-text)' },
          }}
        >
          {link.label}
        </Box>
      )
    }

    return linkContent
  }

  return (
    <Box
      component="footer"
      sx={{
        borderTop: '1px solid var(--morius-card-border)',
        backgroundColor: 'var(--morius-app-base)',
        py: '40px',
        px: { xs: '20px', md: '20px' },
      }}
    >
      {/* Main footer content */}
      <Box
        sx={{
          maxWidth: '1400px',
          mx: 'auto',
          display: 'grid',
          gap: '20px',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' },
          mb: '20px',
          pb: '20px',
          borderBottom: '1px solid var(--morius-card-border)',
          justifyItems: 'center',
        }}
      >
        {/* О проекте */}
        <Stack spacing={1.2}>
          <Typography
            sx={{
              color: '#ffffff',
              fontSize: '20px',
              fontWeight: 700,
              fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
            }}
          >
            О проекте
          </Typography>
          <Typography
            sx={{
              color: 'var(--morius-text-secondary)',
              fontSize: '16px',
              fontWeight: 400,
              fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
              lineHeight: 1.5,
            }}
          >
            {FOOTER_PROJECT_DESCRIPTION}
          </Typography>
        </Stack>

        {/* Соц сети */}
        <Stack spacing={0.6}>
          <Typography
            sx={{
              color: '#ffffff',
              fontSize: '20px',
              fontWeight: 700,
              fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
            }}
          >
            Соц сети
          </Typography>
          <Stack spacing={0.6}>
            {socialLinks.map((link) => renderLink(link, !!link.external))}
          </Stack>
        </Stack>

        {/* Информация */}
        <Stack spacing={0.6}>
          <Typography
            sx={{
              color: '#ffffff',
              fontSize: '20px',
              fontWeight: 700,
              fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
            }}
          >
            Информация
          </Typography>
          <Stack spacing={0.6}>
            {infoLinks.map((link) => renderLink(link, false))}
          </Stack>
        </Stack>
      </Box>

      {/* Copyright section */}
      <Box sx={{ textAlign: 'center' }}>
        <Typography
          sx={{
            color: 'var(--morius-text-secondary)',
            fontSize: '16px',
            fontWeight: 400,
            fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
            mb: '10px',
          }}
        >
          © MoRius
        </Typography>
        <Typography
          sx={{
            color: 'var(--morius-text-secondary)',
            fontSize: '14px',
            fontWeight: 400,
            fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
            lineHeight: 1.4,
          }}
        >
          {FOOTER_CREDIT_TEXT}
        </Typography>
      </Box>
    </Box>
  )
}
