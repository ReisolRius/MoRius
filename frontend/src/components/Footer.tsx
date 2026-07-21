import { Box, Stack, Typography } from '@mui/material'
import { brandLogo } from '../assets'

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

const TELEGRAM_URL = 'https://t.me/+t2ueY4x_KvE4ZWEy'
const VK_URL = 'https://vk.com/moriusai'
const FOOTER_CREDIT = 'ИП Бондарук Александр Георгиевич · ИНН 772702320496 · ОГРНИП 325774600487692 · alexunderstood8@gmail.com'
const TEXT_COLOR = 'var(--morius-text-secondary)'

const PLATFORM_LINKS: FooterLink[] = [
  { label: 'Главная', path: '/dashboard' },
  { label: 'Сообщество', path: '/games/all' },
  { label: 'Магазин', path: '/shop' },
  { label: 'Ежедневные награды', path: '/dashboard' },
]

const CREATIVE_LINKS: FooterLink[] = [
  // Plain hrefs intentionally remount the community page so its query-backed tab state is initialized correctly.
  { label: 'Миры', href: '/games/all?tab=worlds' },
  { label: 'Персонажи', href: '/games/all?tab=characters' },
  { label: 'Правила', href: '/games/all?tab=rules' },
  { label: 'Стать креатором', href: TELEGRAM_URL, external: true },
]

const DEFAULT_INFO_LINKS: FooterLink[] = [
  { label: 'Политика конфиденциальности', path: '/privacy-policy' },
  { label: 'Пользовательское соглашение', path: '/terms-of-service' },
]

/** Telegram circle icon retained from the current MoRius footer artwork. */
function TelegramIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 50 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M25.0009,52c13.81,0 25,-11.6406 25,-26c0,-14.3594 -11.19,-26 -25,-26c-13.81,0 -25,11.6406 -25,26c0,14.3594 11.19,26 25,26z" fill="#D4CDC8" />
      <path fillRule="evenodd" clipRule="evenodd" d="M11.3209,25.7255c7.28,-3.3022 12.14,-5.4793 14.57,-6.5312c6.95,-3.0032 8.39,-3.5249 9.33,-3.5421c0.21,-0.0038 0.67,0.0495 0.97,0.3023c0.25,0.2134 0.32,0.5017 0.36,0.7041c0.03,0.2023 0.07,0.6633 0.04,1.0235c-0.38,4.1112 -2.01,14.088 -2.84,18.6927c-0.35,1.9484 -1.04,2.6016 -1.7,2.6656c-1.46,0.1389 -2.56,-0.9978 -3.96,-1.9565c-2.2,-1.5 -3.45,-2.4338 -5.58,-3.8975c-2.47,-1.6916 -0.87,-2.6214 0.54,-4.1409c0.36,-0.3976 6.76,-6.4486 6.88,-6.9975c0.02,-0.0686 0.03,-0.3245 -0.11,-0.4597c-0.15,-0.1351 -0.36,-0.0889 -0.52,-0.0521c-0.22,0.0521 -3.74,2.4683 -10.55,7.2487c-0.99,0.7125 -1.9,1.0597 -2.71,1.0415c-0.89,-0.0201 -2.61,-0.5249 -3.88,-0.9564c-1.57,-0.5293 -2.81,-0.8091 -2.7,-1.708c0.05,-0.4682 0.67,-0.947 1.86,-1.4365z" fill="#111111" />
    </svg>
  )
}

/** VK rounded-rect icon retained from the current MoRius footer artwork. */
function VkIcon() {
  return (
    <svg width="30" height="30" viewBox="80 0 50 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M80.0009,24.96c0,-11.7663 0,-17.6494 3.51,-21.3047c3.52,-3.6553 9.18,-3.6553 20.49,-3.6553h2c11.31,0 16.97,0 20.48,3.6553c3.52,3.6553 3.52,9.5384 3.52,21.3047v2.08c0,11.7663 0,17.6493 -3.52,21.3047c-3.51,3.6553 -9.17,3.6553 -20.48,3.6553h-2c-11.31,0 -16.97,0 -20.49,-3.6553c-3.51,-3.6554 -3.51,-9.5384 -3.51,-21.3047z" fill="#D4CDC8" />
      <path d="M106.6009,37.4618c-11.39,0 -17.89,-8.125 -18.16,-21.645h5.7c0.19,9.9233 4.4,14.1266 7.73,14.9933v-14.9933h5.38v8.5583c3.29,-0.3683 6.75,-4.2683 7.92,-8.5583h5.37c-0.9,5.2866 -4.65,9.1866 -7.31,10.79c2.66,1.3 6.94,4.7016 8.56,10.855h-5.92c-1.27,-4.1167 -4.43,-7.3017 -8.62,-7.735v7.735z" fill="#111111" />
    </svg>
  )
}

type FooterSectionProps = {
  title: string
  links: FooterLink[]
  onNavigate?: (path: string) => void
}

function FooterSection({ title, links, onNavigate }: FooterSectionProps) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        sx={{
          mb: { xs: 1.4, md: 2 },
          color: 'var(--morius-muted-text)',
          fontSize: { xs: '0.71rem', md: '0.76rem' },
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: '0.16em !important',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </Typography>
      <Stack spacing={{ xs: 1.05, md: 1.35 }} alignItems="flex-start">
        {links.map((link) => {
          const sharedSx = {
            p: 0,
            m: 0,
            border: 'none',
            background: 'none',
            color: TEXT_COLOR,
            font: 'inherit',
            fontFamily: '"Manrope", sans-serif',
            fontSize: { xs: '0.83rem', md: '0.94rem' },
            fontWeight: 450,
            lineHeight: 1.35,
            textAlign: 'left',
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'color 160ms ease',
            '&:hover': { color: 'var(--morius-title-text)' },
            '&:focus-visible': {
              outline: '2px solid color-mix(in srgb, var(--morius-accent) 48%, transparent)',
              outlineOffset: '3px',
              borderRadius: '3px',
            },
          } as const

          if (link.path && onNavigate) {
            return (
              <Box key={`${title}-${link.label}`} component="button" type="button" onClick={() => onNavigate(link.path!)} sx={sharedSx}>
                {link.label}
              </Box>
            )
          }

          const href = link.href ?? link.path
          return href ? (
            <Box
              key={`${title}-${link.label}`}
              component="a"
              href={href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noopener noreferrer' : undefined}
              sx={sharedSx}
            >
              {link.label}
            </Box>
          ) : null
        })}
      </Stack>
    </Box>
  )
}

export default function Footer({ socialLinks = [], infoLinks = [], onNavigate }: FooterProps) {
  const telegramLink = socialLinks.find((link) => link.href?.includes('t.me')) ?? {
    label: 'Telegram',
    href: TELEGRAM_URL,
    external: true,
  }
  const vkLink = socialLinks.find((link) => link.href?.includes('vk.com')) ?? {
    label: 'ВКонтакте',
    href: VK_URL,
    external: true,
  }
  const legalLinks = infoLinks.length > 0 ? infoLinks : DEFAULT_INFO_LINKS
  const helpLinks: FooterLink[] = [
    { label: 'Мориус Вики', path: '/wiki' },
    { label: 'Поддержка', href: TELEGRAM_URL, external: true },
    { label: 'Реферальная программа', path: '/profile#referral-program' },
    ...legalLinks.filter((link) => link.path !== '/wiki'),
  ]

  return (
    <Box
      component="footer"
      sx={{
        width: '100%',
        mt: { xs: 5, md: 8 },
        color: TEXT_COLOR,
        background: 'color-mix(in srgb, var(--morius-app-bg) 90%, #080b0e 10%)',
        borderTop: 'var(--morius-border-width) solid rgba(255,255,255,0.055)',
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 1500,
          mx: 'auto',
          px: { xs: 2.4, sm: 3.5, md: 5 },
          pt: { xs: 4, md: 6.5 },
          pb: { xs: 4, md: 6 },
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            md: 'minmax(280px, 1.5fr) repeat(3, minmax(150px, 1fr))',
          },
          columnGap: { xs: 2.4, sm: 4, md: 6 },
          rowGap: { xs: 3.5, md: 0 },
        }}
      >
        <Stack
          spacing={{ xs: 2, md: 2.35 }}
          alignItems="flex-start"
          sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, maxWidth: 390 }}
        >
          <Stack direction="row" spacing={1.4} alignItems="center">
            <Box component="img" src={brandLogo} alt="" sx={{ width: { xs: 48, md: 54 }, height: 'auto', opacity: 0.94 }} />
            <Typography
              sx={{
                color: 'var(--morius-title-text)',
                fontFamily: '"Spectral", "Times New Roman", serif',
                fontSize: { xs: '1.7rem', md: '1.95rem' },
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              MoRius
            </Typography>
          </Stack>
          <Typography
            sx={{
              color: TEXT_COLOR,
              fontFamily: '"Manrope", sans-serif',
              fontSize: { xs: '0.84rem', md: '0.95rem' },
              lineHeight: 1.7,
              maxWidth: 350,
            }}
          >
            Платформа текстовых ИИ-приключений. Создавайте миры, персонажей и правила — истории напишутся сами.
          </Typography>
          <Stack direction="row" spacing={1.1} alignItems="center">
            {[
              { link: vkLink, icon: <VkIcon /> },
              { link: telegramLink, icon: <TelegramIcon /> },
            ].map(({ link, icon }) => (
              <Box
                key={link.label}
                component="a"
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.label}
                title={link.label}
                sx={{
                  width: 46,
                  height: 46,
                  display: 'grid',
                  placeItems: 'center',
                  textDecoration: 'none',
                  borderRadius: '13px',
                  border: 'var(--morius-border-width) solid rgba(255,255,255,0.1)',
                  backgroundColor: 'rgba(255,255,255,0.025)',
                  transition: 'border-color 160ms ease, background-color 160ms ease, transform 160ms ease',
                  '& svg': { width: 25, height: 25 },
                  '&:hover': {
                    borderColor: 'color-mix(in srgb, var(--morius-accent) 56%, rgba(255,255,255,0.1))',
                    backgroundColor: 'rgba(255,255,255,0.045)',
                    transform: 'translateY(-1px)',
                  },
                  '&:focus-visible': {
                    outline: '2px solid color-mix(in srgb, var(--morius-accent) 52%, transparent)',
                    outlineOffset: '3px',
                  },
                }}
              >
                {icon}
              </Box>
            ))}
          </Stack>
        </Stack>

        <FooterSection title="Платформа" links={PLATFORM_LINKS} onNavigate={onNavigate} />
        <FooterSection title="Творчество" links={CREATIVE_LINKS} onNavigate={onNavigate} />
        <FooterSection title="Помощь" links={helpLinks} onNavigate={onNavigate} />
      </Box>

      <Box sx={{ maxWidth: 1500, mx: 'auto', px: { xs: 2.4, sm: 3.5, md: 5 } }}>
        <Box sx={{ height: '1px', backgroundColor: 'rgba(255,255,255,0.065)' }} />
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={{ xs: 1, md: 2 }}
          alignItems={{ xs: 'flex-start', md: 'center' }}
          justifyContent="space-between"
          sx={{ py: { xs: 2.5, md: 2.6 } }}
        >
          <Typography sx={{ color: 'var(--morius-quiet-text)', fontSize: { xs: '0.75rem', md: '0.81rem' }, whiteSpace: 'nowrap' }}>
            © 2026 MoRius
          </Typography>
          <Typography
            sx={{
              color: 'var(--morius-quiet-text)',
              fontSize: { xs: '0.68rem', sm: '0.74rem', md: '0.81rem' },
              lineHeight: 1.55,
              textAlign: { xs: 'left', md: 'right' },
              overflowWrap: 'anywhere',
            }}
          >
            {FOOTER_CREDIT}
          </Typography>
        </Stack>
      </Box>
    </Box>
  )
}
