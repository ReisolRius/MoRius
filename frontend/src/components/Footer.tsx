import { Box, Stack } from '@mui/material'
import logoUrl from '../assets/brand/logo.svg'

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

const FOOTER_CREDIT = 'Бондарук Александр Георгиевич | ИНН: 772702320496 | ОГРНИП: 325774600487692 | Почта: alexunderstood8@gmail.com'
const TEXT_COLOR = '#b6ada4'

/** Telegram circle icon — extracted from Figma f0adfe.svg (left half, viewBox 0 0 50 52) */
function TelegramIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 50 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M25.0009,52c13.81,0 25,-11.6406 25,-26c0,-14.3594 -11.19,-26 -25,-26c-13.81,0 -25,11.6406 -25,26c0,14.3594 11.19,26 25,26z" fill="#D4CDC8"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M11.3209,25.7255c7.28,-3.3022 12.14,-5.4793 14.57,-6.5312c6.95,-3.0032 8.39,-3.5249 9.33,-3.5421c0.21,-0.0038 0.67,0.0495 0.97,0.3023c0.25,0.2134 0.32,0.5017 0.36,0.7041c0.03,0.2023 0.07,0.6633 0.04,1.0235c-0.38,4.1112 -2.01,14.088 -2.84,18.6927c-0.35,1.9484 -1.04,2.6016 -1.7,2.6656c-1.46,0.1389 -2.56,-0.9978 -3.96,-1.9565c-2.2,-1.5 -3.45,-2.4338 -5.58,-3.8975c-2.47,-1.6916 -0.87,-2.6214 0.54,-4.1409c0.36,-0.3976 6.76,-6.4486 6.88,-6.9975c0.02,-0.0686 0.03,-0.3245 -0.11,-0.4597c-0.15,-0.1351 -0.36,-0.0889 -0.52,-0.0521c-0.22,0.0521 -3.74,2.4683 -10.55,7.2487c-0.99,0.7125 -1.9,1.0597 -2.71,1.0415c-0.89,-0.0201 -2.61,-0.5249 -3.88,-0.9564c-1.57,-0.5293 -2.81,-0.8091 -2.7,-1.708c0.05,-0.4682 0.67,-0.947 1.86,-1.4365z" fill="#111111"/>
    </svg>
  )
}

/** VK rounded-rect icon — extracted from Figma f0adfe.svg (right half, viewBox 80 0 50 52) */
function VkIcon() {
  return (
    <svg width="30" height="30" viewBox="80 0 50 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M80.0009,24.96c0,-11.7663 0,-17.6494 3.51,-21.3047c3.52,-3.6553 9.18,-3.6553 20.49,-3.6553h2c11.31,0 16.97,0 20.48,3.6553c3.52,3.6553 3.52,9.5384 3.52,21.3047v2.08c0,11.7663 0,17.6493 -3.52,21.3047c-3.51,3.6553 -9.17,3.6553 -20.48,3.6553h-2c-11.31,0 -16.97,0 -20.49,-3.6553c-3.51,-3.6554 -3.51,-9.5384 -3.51,-21.3047z" fill="#D4CDC8"/>
      <path d="M106.6009,37.4618c-11.39,0 -17.89,-8.125 -18.16,-21.645h5.7c0.19,9.9233 4.4,14.1266 7.73,14.9933v-14.9933h5.38v8.5583c3.29,-0.3683 6.75,-4.2683 7.92,-8.5583h5.37c-0.9,5.2866 -4.65,9.1866 -7.31,10.79c2.66,1.3 6.94,4.7016 8.56,10.855h-5.92c-1.27,-4.1167 -4.43,-7.3017 -8.62,-7.735v7.735z" fill="#111111"/>
    </svg>
  )
}

export default function Footer({ socialLinks = [], infoLinks = [], onNavigate }: FooterProps) {
  const telegramLink = socialLinks.find((l) => l.href?.includes('t.me'))
  const vkLink = socialLinks.find((l) => l.href?.includes('vk.com'))

  return (
    <Box
      component="footer"
      sx={{ backgroundColor: 'var(--morius-app-base)', width: '100%' }}
    >
      {/* ── Top bar: logo | nav links | social icons ─────────────────── */}
      <Box
        sx={{
          maxWidth: 1400,
          mx: 'auto',
          px: { xs: '20px', md: '60px' },
          py: { xs: '20px', md: '28px' },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 3,
        }}
      >
        {/* Logo */}
        <Box
          component="img"
          src={logoUrl}
          alt="Morius"
          sx={{ height: { xs: 50, md: 64 }, width: 'auto', flexShrink: 0, opacity: 0.9 }}
        />

        {/* Nav links — centered */}
        <Stack direction="row" spacing={{ xs: '32px', md: '60px' }} alignItems="center">
          {infoLinks.map((link) =>
            link.path && onNavigate ? (
              <Box
                key={link.label}
                component="button"
                type="button"
                onClick={() => onNavigate(link.path!)}
                sx={{
                  p: 0, m: 0, border: 'none', background: 'none',
                  color: TEXT_COLOR, font: 'inherit',
                  fontSize: { xs: '14px', md: '17px' },
                  fontWeight: 400,
                  fontFamily: '"Nunito Sans", sans-serif',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  transition: 'color 180ms ease',
                  '&:hover': { color: 'var(--morius-title-text)' },
                  '&:focus-visible': { outline: '2px solid rgba(205,223,246,0.56)', outlineOffset: '2px', borderRadius: '3px' },
                }}
              >
                {link.label}
              </Box>
            ) : link.href ? (
              <Box
                key={link.label}
                component="a"
                href={link.href}
                target={link.external ? '_blank' : undefined}
                rel={link.external ? 'noopener noreferrer' : undefined}
                sx={{
                  color: TEXT_COLOR, textDecoration: 'none',
                  fontSize: { xs: '14px', md: '17px' },
                  fontWeight: 400, fontFamily: '"Nunito Sans", sans-serif',
                  whiteSpace: 'nowrap',
                  transition: 'color 180ms ease',
                  '&:hover': { color: 'var(--morius-title-text)' },
                }}
              >
                {link.label}
              </Box>
            ) : null,
          )}
        </Stack>

        {/* Social icon buttons from Figma */}
        <Stack direction="row" spacing="16px" alignItems="center" sx={{ flexShrink: 0 }}>
          {telegramLink?.href && (
            <Box
              component="a"
              href={telegramLink.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={telegramLink.label}
              title={telegramLink.label}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                textDecoration: 'none', borderRadius: '50%',
                transition: 'opacity 180ms ease, transform 180ms ease',
                '&:hover': { opacity: 0.8, transform: 'translateY(-1px)' },
                '&:focus-visible': { outline: '2px solid rgba(205,223,246,0.56)', outlineOffset: '3px', borderRadius: '50%' },
              }}
            >
              <TelegramIcon />
            </Box>
          )}
          {vkLink?.href && (
            <Box
              component="a"
              href={vkLink.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={vkLink.label}
              title={vkLink.label}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                textDecoration: 'none', borderRadius: '12px',
                transition: 'opacity 180ms ease, transform 180ms ease',
                '&:hover': { opacity: 0.8, transform: 'translateY(-1px)' },
                '&:focus-visible': { outline: '2px solid rgba(205,223,246,0.56)', outlineOffset: '3px', borderRadius: '14px' },
              }}
            >
              <VkIcon />
            </Box>
          )}
        </Stack>
      </Box>

      {/* ── Divider ───────────────────────────────────────────────────── */}
      <Box
        aria-hidden
        sx={{
          height: '1px',
          backgroundColor: 'rgba(255,255,255,0.1)',
          mx: 0,
        }}
      />

      {/* ── Bottom bar: centered legal text + copyright ──────────────── */}
      <Box
        sx={{
          py: { xs: '14px', md: '18px' },
          px: { xs: '20px', md: '60px' },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          flexWrap: 'wrap',
          textAlign: 'center',
        }}
      >
        <Box
          component="span"
          sx={{
            color: TEXT_COLOR,
            fontSize: { xs: '11px', sm: '13px', md: '14px' },
            fontWeight: 400,
            fontFamily: '"Nunito Sans", sans-serif',
            lineHeight: 1.5,
          }}
        >
          {FOOTER_CREDIT}
        </Box>
        <Box
          component="span"
          sx={{
            color: TEXT_COLOR,
            fontSize: '14px',
            fontWeight: 400,
            fontFamily: '"Nunito Sans", sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          © 2026
        </Box>
      </Box>
    </Box>
  )
}
