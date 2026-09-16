import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Box, Stack, Typography, type SxProps, type Theme } from '@mui/material'
import { brandLogo, icons } from '../assets'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  BoltIcon,
  CloseIcon,
  DiceIcon,
  HourglassIcon,
  LayersIcon,
  MenuIcon,
  MinusIcon,
  PeopleIcon,
  PlusIcon,
  QuillIcon,
  RhombusIcon,
  SlidersIcon,
  SparkIcon,
  StairsIcon,
  TelegramIcon,
  UnlockIcon,
} from '../components/landing/LandingIcons'
import Footer from '../components/Footer'
import { fetchLandingShowcase, type LandingShowcase } from '../services/landingApi'

const TELEGRAM_URL = 'https://t.me/+t2ueY4x_KvE4ZWEy'
const HERO_IMAGE = '/landing/hero.webp'
const GUIDE_IMAGE = '/landing/guide.webp'

/**
 * The presentation page follows the approved mockup layout exactly, repainted in the AI
 * Dungeon palette the rest of the product now uses: a black page, the cool `core` neutrals for
 * surfaces, and one flat amber accent. The mockup's beige `--paper` became the black page, and
 * its dark-teal sections became near-black with the same radial shape they had.
 */
const L = {
  page: '#000000',
  pageArt: 'radial-gradient(120% 85% at 18% -6%, #0d0e0f 0%, #070708 45%, #010102 75%, #000000 100%)',
  /** Sections the mockup painted dark teal. Kept a touch above the page so the torn edge reads. */
  deep: '#0d0e0f',
  deepArt: 'radial-gradient(ellipse at 50% 100%, #1e2226 0%, transparent 70%), #0d0e0f',
  surface: 'rgba(199,231,255,0.055)',
  surfaceSolid: '#1b1f22',
  elevated: '#272c30',
  border: 'rgba(199,231,255,0.13)',
  borderStrong: 'rgba(219,241,255,0.22)',
  accent: '#f8ae2c',
  accentSoft: 'rgba(248,174,44,0.12)',
  accentBorder: 'rgba(248,174,44,0.38)',
  title: '#f9f7f4',
  text: '#c5cbd2',
  muted: '#828a92',
  quiet: '#666d75',
  serif: 'var(--morius-font-heading, Georgia, "Times New Roman", serif)',
  ui: 'var(--morius-font-ui, "Manrope", "Segoe UI", sans-serif)',
} as const

const WRAP: SxProps<Theme> = {
  width: 'min(1160px, calc(100% - 80px))',
  mx: 'auto',
  '@media (max-width: 1000px)': { width: 'calc(100% - 48px)' },
  '@media (max-width: 720px)': { width: 'calc(100% - 36px)' },
}

const H2: SxProps<Theme> = {
  fontFamily: L.serif,
  fontWeight: 400,
  color: L.title,
  fontSize: 'clamp(34px, 4vw, 55px)',
  lineHeight: 1.12,
  letterSpacing: '-1.5px',
  '@media (max-width: 720px)': { fontSize: '37px' },
}

const H3: SxProps<Theme> = {
  fontFamily: L.serif,
  fontWeight: 400,
  color: L.title,
  fontSize: '27px',
  lineHeight: 1.2,
}

const BODY: SxProps<Theme> = { fontFamily: L.ui, fontSize: 15, lineHeight: 1.75, color: L.muted }

// ---------------------------------------------------------------------------- small pieces

function Eyebrow({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' }) {
  return (
    <Box
      sx={{
        fontFamily: L.ui,
        fontSize: 12,
        letterSpacing: '2.4px',
        textTransform: 'uppercase',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        mb: '23px',
        color: tone === 'accent' ? L.accent : L.muted,
        '&:before': { content: '""', height: '1px', width: '36px', background: 'currentColor', opacity: 0.7 },
        '@media (max-width: 720px)': { fontSize: 11, letterSpacing: '1.8px', mb: '19px' },
      }}
    >
      {children}
    </Box>
  )
}

type ActionProps = {
  children: ReactNode
  onClick?: () => void
  href?: string
  variant?: 'solid' | 'ghost'
  icon?: ReactNode
  sx?: SxProps<Theme>
  ariaLabel?: string
}

/** The mockup's `.btn`. Solid is the flat amber accent — never a gradient. */
function Action({ children, onClick, href, variant = 'solid', icon, sx, ariaLabel }: ActionProps) {
  const solid = variant === 'solid'
  return (
    <Box
      component={href ? 'a' : 'button'}
      href={href}
      onClick={onClick}
      type={href ? undefined : 'button'}
      aria-label={ariaLabel}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '26px',
        px: '25px',
        py: '14px',
        minHeight: 51,
        border: `1px solid ${solid ? L.accent : L.border}`,
        background: solid ? L.accent : 'transparent',
        color: solid ? '#161009' : L.title,
        fontFamily: L.ui,
        fontSize: 14,
        fontWeight: 700,
        textDecoration: 'none',
        cursor: 'pointer',
        transition: 'background 180ms ease, border-color 180ms ease, transform 180ms ease',
        '&:hover': {
          background: solid ? '#ffb83c' : 'transparent',
          borderColor: solid ? '#ffb83c' : L.accent,
          transform: 'translateY(-2px)',
        },
        '&:focus-visible': { outline: `3px solid ${L.accent}`, outlineOffset: 5 },
        '@media (max-width: 720px)': { px: '18px', py: '13px', fontSize: 13, gap: '15px' },
        ...sx,
      }}
    >
      <span>{children}</span>
      {icon ?? <ArrowUpRightIcon size={18} />}
    </Box>
  )
}

/**
 * The ragged edge the mockup used between its paper and dark sections. Here it cuts the page
 * black into the slightly lighter section above/below it, so the tear still reads.
 */
function TornEdge({ place }: { place: 'top' | 'bottom' }) {
  const bottom =
    'polygon(0 45%,2% 57%,3% 35%,5% 65%,7% 46%,9% 64%,12% 30%,14% 55%,17% 42%,19% 68%,22% 37%,25% 58%,28% 40%,30% 61%,34% 33%,38% 62%,41% 48%,44% 64%,47% 33%,51% 56%,54% 43%,57% 65%,60% 37%,64% 61%,67% 39%,70% 66%,73% 50%,76% 30%,79% 57%,82% 38%,85% 64%,88% 41%,91% 61%,94% 40%,97% 64%,100% 42%,100% 100%,0 100%)'
  const top =
    'polygon(0 0,100% 0,100% 40%,95% 65%,90% 30%,84% 70%,78% 40%,72% 65%,65% 25%,58% 75%,50% 40%,44% 60%,37% 25%,31% 75%,23% 40%,17% 70%,10% 30%,4% 65%,0 35%)'
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        height: place === 'bottom' ? 37 : 24,
        [place]: '-1px',
        background: L.page,
        clipPath: place === 'bottom' ? bottom : top,
        zIndex: 1,
        pointerEvents: 'none',
      }}
    />
  )
}

function Section({
  children,
  id,
  sx,
  component = 'section',
}: {
  children: ReactNode
  id?: string
  sx?: SxProps<Theme>
  component?: 'section' | 'div'
}) {
  return (
    <Box
      component={component}
      id={id}
      sx={{ py: '99px', position: 'relative', '@media (max-width: 1000px)': { py: '75px' }, '@media (max-width: 720px)': { py: '65px' }, ...sx }}
    >
      {children}
    </Box>
  )
}

// ---------------------------------------------------------------------------- page content

const FORMATS = [
  {
    num: '01',
    Icon: QuillIcon,
    title: 'Storytelling',
    text: 'Свободные текстовые истории и приключения без жёстких рамок. Только ты, твои решения и то, что случится дальше.',
    tag: 'Свобода воображения',
    featured: false,
  },
  {
    num: '02',
    Icon: DiceIcon,
    title: 'D&D / RPG',
    text: 'AI-мастер, твой персонаж, живой мир и правила. От первого броска кубика до собственной большой кампании.',
    tag: 'Приключение по твоим правилам',
    featured: true,
  },
  {
    num: '03',
    Icon: RhombusIcon,
    title: 'Визуальная новелла',
    text: 'Персонажи, эмоции и атмосферные фоны. История раскрывается сцена за сценой — с тобой в главной роли.',
    tag: 'Почувствуй каждую сцену',
    featured: false,
  },
] as const

const TIERS = [
  {
    label: '01 / ЛЁГКИЙ СТАРТ',
    title: 'Бюджетные',
    text: 'Для знакомства с миром и повседневных приключений. Больше игры при небольшом бюджете.',
  },
  {
    label: '02 / ЗОЛОТАЯ СЕРЕДИНА',
    title: 'Сбалансированные',
    text: 'Для развёрнутых сцен и долгих историй. Баланс стоимости и выразительности повествования.',
  },
  {
    label: '03 / ОСОБЫЙ МОМЕНТ',
    title: 'Премиальные',
    text: 'Для сложных сюжетов, ярких диалогов и сцен, которым хочется уделить больше внимания.',
  },
] as const

/** The six tiers a turn's memory actually passes through in `story_memory_pipeline`. */
const MEMORY_STAGES = [
  { num: '01', title: 'Полный ход', text: 'Свежая сцена хранится целиком — ничего не теряется, пока она ещё нужна дословно.' },
  { num: '02', title: 'Очередь', text: 'Ход встаёт в очередь на обработку, чтобы игра не ждала и ты продолжал писать.' },
  { num: '03', title: 'Детальный пересказ', text: 'Сцена превращается в подробный пересказ: реплики, решения и последствия остаются.' },
  { num: '04', title: 'Сжатая выжимка', text: 'Детали ужимаются до сути эпизода, когда история уходит дальше по сюжету.' },
  { num: '05', title: 'Факты', text: 'Из эпизода остаются факты о мире и персонажах — то, что нужно помнить всегда.' },
  { num: '06', title: 'Важное в ядре', text: 'Ключевые события поднимаются в постоянную память и не выпадают даже через сотни ходов.' },
] as const

const EXPERIENCE = [
  { title: 'У каждой реплики — голос', text: 'Аватарки и оформление чата помогают узнавать персонажей и следить за диалогом.' },
  { title: 'У каждой сцены — ритм', text: 'Реплики и повествование разделены, чтобы история легко читалась и увлекала дальше.' },
  { title: 'У каждого мира — атмосфера', text: 'Визуальная подача и фоны превращают текст в пространство для воображения.' },
] as const

const FAQ_ITEMS = [
  {
    q: 'Что такое AI-roleplay?',
    a: 'Это ролевая история, которую ты создаёшь вместе с искусственным интеллектом. Ты принимаешь решения за своего героя, а ИИ ведёт повествование, играет других персонажей и отвечает на твои действия.',
  },
  {
    q: 'Чем Moru отличается от обычного AI-чата?',
    a: 'Moru объединяет три формата игры, настройки миров и персонажей, шестиступенчатую память событий и визуальное оформление сцен. Это пространство для продолжительных историй, а не только отдельных диалогов.',
  },
  {
    q: 'Мне нужен опыт в D&D, чтобы начать?',
    a: 'Нет. Можно начать со свободного storytelling и минимума настроек. Режим D&D / RPG — один из вариантов, а не обязательное условие.',
  },
  { q: 'Какие форматы игры есть?', a: 'Свободный storytelling, D&D / RPG с AI-мастером и визуальные новеллы с персонажами, эмоциями и фонами.' },
  {
    q: 'Как работает память истории?',
    a: 'Каждый ход проходит шесть ступеней: полный текст, очередь, детальный пересказ, сжатая выжимка, факты и важное в постоянной памяти. Так длинная кампания помнит свои события, не разрастаясь в бесконечный контекст.',
  },
  {
    q: 'Есть ли ограничения на содержание истории?',
    a: 'Собственных фильтров поверх модели мы не добавляем. Рамки истории определяет только та AI-модель, которую ты выбрал, и закон — всё остальное остаётся на стороне твоего замысла.',
  },
  {
    q: 'Сколько стоит игра?',
    a: 'Ход — от 1 сола. Стоимость зависит от выбранной AI-модели. Есть бюджетные, сбалансированные и премиальные модели, а также подписки и пакеты солов.',
  },
] as const

function SolMark({ size = 30 }: { size?: number }) {
  return <Box component="img" src={icons.coin} alt="" aria-hidden sx={{ width: size, height: size, display: 'block' }} />
}

function FaqItem({ q, a, defaultOpen }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen))
  return (
    <Box component="details" open={open} sx={{ borderBottom: `1px solid ${L.border}` }}>
      <Box
        component="summary"
        onClick={(event: MouseEvent) => {
          event.preventDefault()
          setOpen((value) => !value)
        }}
        sx={{
          listStyle: 'none',
          cursor: 'pointer',
          py: '22px',
          pr: '35px',
          position: 'relative',
          fontFamily: L.ui,
          fontSize: 16,
          color: L.title,
          '&::-webkit-details-marker': { display: 'none' },
          '&:focus-visible': { outline: `3px solid ${L.accent}`, outlineOffset: 5 },
        }}
      >
        {q}
        <Box aria-hidden sx={{ position: 'absolute', right: 0, top: 22, color: L.accent }}>
          {open ? <MinusIcon size={20} /> : <PlusIcon size={20} />}
        </Box>
      </Box>
      <Typography sx={{ ...BODY, pr: '30px', pb: '22px' }}>{a}</Typography>
    </Box>
  )
}

export type PublicLandingPageProps = {
  isAuthenticated: boolean
  pendingReferralCode?: string | null
  onNavigate: (path: string) => void
  onGoHome: () => void
}

export default function PublicLandingPage({ isAuthenticated, pendingReferralCode, onNavigate, onGoHome }: PublicLandingPageProps) {
  const openedReferralCodeRef = useRef<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showcase, setShowcase] = useState<LandingShowcase>({ players: 0, worlds: 0, characters: 0, avatars: [] })

  useEffect(() => {
    const controller = new AbortController()
    void fetchLandingShowcase(controller.signal).then(setShowcase)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (isAuthenticated || !pendingReferralCode || openedReferralCodeRef.current === pendingReferralCode) return
    openedReferralCodeRef.current = pendingReferralCode
    const timerId = window.setTimeout(() => onNavigate('/auth?mode=register'), 0)
    return () => window.clearTimeout(timerId)
  }, [isAuthenticated, onNavigate, pendingReferralCode])

  const openAuthPage = (mode: 'login' | 'register' = 'register') => {
    if (isAuthenticated) {
      onGoHome()
      return
    }
    onNavigate(`/auth?mode=${mode}`)
  }

  /**
   * Rounded down so a claim is never ahead of reality, and null until the real number arrives -
   * a page that has no data must say nothing rather than invent a figure.
   */
  const playersLabel = useMemo(() => {
    const players = showcase.players
    if (players < 10) return null
    if (players < 1000) return `${Math.floor(players / 50) * 50}+`
    return `${Math.floor(players / 500) * 500}+`
  }, [showcase.players])

  const worldsLabel = useMemo(() => {
    const worlds = showcase.worlds
    if (worlds < 10) return null
    if (worlds < 100) return `${Math.floor(worlds / 10) * 10}+`
    return `${Math.floor(worlds / 100) * 100}+`
  }, [showcase.worlds])

  const navLinks = [
    { href: '#formats', label: 'Форматы' },
    { href: '#modes', label: 'Как начать' },
    { href: '#memory', label: 'Память' },
    { href: '#pricing', label: 'Стоимость' },
    { href: '#faq', label: 'FAQ' },
  ]

  const brandNode = (
    <Box
      component="a"
      href="#top"
      aria-label="Moru — на главную"
      sx={{ display: 'flex', alignItems: 'center', gap: '12px', textDecoration: 'none', color: L.title }}
    >
      <Box component="img" src={brandLogo} alt="" aria-hidden sx={{ height: 34, width: 'auto', display: 'block' }} />
      <Box component="span" sx={{ fontFamily: L.serif, fontSize: 32, letterSpacing: '1px', '@media (max-width: 720px)': { fontSize: 28 } }}>
        Moru
      </Box>
    </Box>
  )

  return (
    <Box
      className="moru-landing"
      sx={{
        background: L.page,
        color: L.text,
        fontFamily: L.ui,
        fontSize: 16,
        lineHeight: 1.65,
        scrollBehavior: 'smooth',
        '& a': { color: 'inherit', textDecoration: 'none' },
      }}
    >
      {/* ------------------------------------------------------------------ hero */}
      <Box
        component="section"
        id="top"
        sx={{
          position: 'relative',
          minHeight: 850,
          height: 'min(920px, 100vh)',
          color: L.title,
          background: L.deep,
          isolation: 'isolate',
          overflow: 'hidden',
          '&:before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            zIndex: -2,
            background: `linear-gradient(90deg, rgba(0,0,0,.92), rgba(0,0,0,.5) 43%, rgba(0,0,0,.12) 72%), linear-gradient(0deg, #000000 1%, transparent 35%), url('${HERO_IMAGE}') center 30%/cover`,
          },
          '@media (max-width: 1000px)': { minHeight: 810 },
          '@media (max-width: 720px)': {
            height: 'auto',
            minHeight: 1000,
            pb: '250px',
            '&:before': {
              background: `linear-gradient(0deg, #000000 1%, transparent 29%), linear-gradient(180deg, #000000 5%, rgba(0,0,0,.8) 31%, transparent 64%), url('${HERO_IMAGE}') 70% bottom/auto 740px no-repeat`,
            },
          },
        }}
      >
        <TornEdge place="bottom" />
        <Box sx={WRAP}>
          <Box
            component="header"
            sx={{
              height: 99,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '25px',
              borderBottom: `1px solid ${L.border}`,
              '@media (max-width: 720px)': { height: 78 },
            }}
          >
            {brandNode}
            <Box
              component="nav"
              aria-label="Основная навигация"
              sx={{
                display: 'flex',
                gap: '29px',
                fontSize: 14,
                color: L.text,
                '& a:hover': { color: L.accent },
                '@media (max-width: 1000px)': { gap: '18px' },
                '@media (max-width: 720px)': { display: 'none' },
              }}
            >
              {navLinks.map((link) => (
                <a key={link.href} href={link.href}>
                  {link.label}
                </a>
              ))}
            </Box>
            {/* The mockup left this one transparent and the label disappeared — it is accent-filled now. */}
            <Action onClick={() => openAuthPage('register')} sx={{ px: '19px', py: '9px', minHeight: 42, gap: '14px', '@media (max-width: 720px)': { display: 'none' } }}>
              {isAuthenticated ? 'Продолжить' : 'Начать игру'}
            </Action>
            <Box
              component="button"
              type="button"
              aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
              aria-expanded={menuOpen}
              aria-controls="landing-mobile-nav"
              onClick={() => setMenuOpen((value) => !value)}
              sx={{
                display: 'none',
                background: 'none',
                border: `1px solid ${L.border}`,
                color: L.title,
                p: '7px 12px',
                cursor: 'pointer',
                '@media (max-width: 720px)': { display: 'block' },
              }}
            >
              {menuOpen ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
            </Box>
          </Box>

          {menuOpen ? (
            <Box
              component="nav"
              id="landing-mobile-nav"
              aria-label="Мобильная навигация"
              sx={{
                display: 'none',
                '@media (max-width: 720px)': {
                  display: 'flex',
                  position: 'absolute',
                  top: 77,
                  left: 0,
                  right: 0,
                  background: '#0d0e0f',
                  p: '22px',
                  flexDirection: 'column',
                  gap: '17px',
                  zIndex: 9,
                  borderBottom: `1px solid ${L.accentBorder}`,
                },
              }}
            >
              {navLinks.map((link) => (
                <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
                  {link.label}
                </a>
              ))}
              <Action onClick={() => openAuthPage('register')}>{isAuthenticated ? 'Продолжить' : 'Начать игру'}</Action>
            </Box>
          ) : null}

          <Box
            sx={{
              pt: '106px',
              width: 570,
              maxWidth: '55%',
              '@media (max-width: 1000px)': { maxWidth: '59%', pt: '95px' },
              '@media (max-width: 720px)': { pt: '44px', maxWidth: 'none', width: '100%' },
            }}
          >
            <Eyebrow tone="accent">Платформа для живых AI-историй</Eyebrow>
            <Typography
              component="h1"
              sx={{
                fontFamily: L.serif,
                fontWeight: 400,
                fontSize: 'clamp(48px, 5.7vw, 77px)',
                lineHeight: 1.06,
                letterSpacing: '-2.6px',
                color: L.title,
                '@media (max-width: 1000px)': { fontSize: 62 },
                '@media (max-width: 720px)': { fontSize: 'clamp(43px, 10vw, 60px)', letterSpacing: '-1.8px' },
              }}
            >
              Твой мир.
              <br />
              Твои правила.
              <br />
              <Box component="em" sx={{ color: L.accent, fontStyle: 'normal' }}>
                ИИ ведёт
                <br />
                историю.
              </Box>
            </Typography>
            <Typography sx={{ maxWidth: 455, color: L.text, m: '25px 0 31px', fontSize: 17, fontFamily: L.ui, lineHeight: 1.75, '@media (max-width: 720px)': { fontSize: 15, maxWidth: 390, m: '22px 0' } }}>
              Свободный storytelling, D&amp;D и визуальные новеллы — в одной платформе для долгих, живых приключений.
            </Typography>
            <Box sx={{ display: 'flex', gap: '12px', flexWrap: 'wrap', '@media (max-width: 720px)': { gap: '10px' } }}>
              <Action onClick={() => openAuthPage('register')}>{isAuthenticated ? 'Продолжить историю' : 'Начать игру'}</Action>
              <Action href="#formats" variant="ghost" icon={<ArrowDownIcon size={18} />}>
                Как это работает
              </Action>
            </Box>
            <Box sx={{ display: 'flex', gap: '28px', mt: '34px', fontSize: 12, color: L.muted, flexWrap: 'wrap', '@media (max-width: 720px)': { mt: '25px', gap: '24px' } }}>
              {[
                playersLabel ? { strong: playersLabel, rest: 'игроков' } : null,
                worldsLabel ? { strong: `${worldsLabel} миров`, rest: 'создано сообществом' } : null,
                { strong: 'Несколько AI-моделей', rest: 'под твой стиль' },
                { strong: 'Любой опыт', rest: 'от первого шага до профи' },
              ]
                .filter((item): item is { strong: string; rest: string } => item !== null)
                .map((item) => (
                <Box key={item.strong}>
                  <Box component="strong" sx={{ display: 'block', color: L.title, fontSize: 17, fontWeight: 400, fontFamily: L.serif }}>
                    {item.strong}
                  </Box>
                  {item.rest}
                </Box>
              ))}
            </Box>
          </Box>

          <Box
            sx={{
              position: 'absolute',
              right: 'max(40px, calc((100% - 1160px) / 2))',
              bottom: 100,
              width: 360,
              background: 'rgba(13,14,15,0.85)',
              border: `1px solid ${L.accentBorder}`,
              backdropFilter: 'blur(15px)',
              p: '18px 22px',
              boxShadow: '0 14px 50px rgba(0,0,0,0.35)',
              '@media (max-width: 1000px)': { width: 300, right: 24, bottom: 74 },
              '@media (max-width: 720px)': { bottom: 57, left: 18, right: 18, width: 'auto' },
            }}
          >
            <Box sx={{ fontSize: 11, letterSpacing: '1.5px', color: L.accent, display: 'flex', alignItems: 'center', gap: '9px' }}>
              <Box sx={{ width: 5, height: 5, background: L.accent, borderRadius: '50%' }} />
              AI-МАСТЕР · ПРИМЕР СЦЕНЫ
            </Box>
            <Typography sx={{ fontFamily: L.serif, fontSize: 15, m: '9px 0', color: L.title, lineHeight: 1.6 }}>
              «За этой дверью начинается мир, которого ещё не было. Ну что, откроем?»
            </Typography>
            <Box sx={{ fontSize: 12, color: L.muted }}>Твоя история начинается с выбора.</Box>
          </Box>

          <Box sx={{ position: 'absolute', bottom: 47, fontSize: 11, letterSpacing: '2px', color: L.quiet, display: 'flex', alignItems: 'center', gap: '10px', '@media (max-width: 720px)': { display: 'none' } }}>
            ЛИСТАЙ, ЧТОБЫ ОТКРЫТЬ БОЛЬШЕ <ArrowDownIcon size={16} />
          </Box>
        </Box>
      </Box>

      <Box component="main" sx={{ background: L.pageArt }}>
        {/* --------------------------------------------------------------- formats */}
        <Section id="formats">
          <Box sx={WRAP}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'end',
                gap: '40px',
                mb: '45px',
                '@media (max-width: 720px)': { display: 'block', mb: '29px' },
              }}
            >
              <Box>
                <Eyebrow>Три способа прожить историю</Eyebrow>
                <Typography component="h2" sx={H2}>
                  Одно воображение.
                  <br />
                  Целая вселенная возможностей.
                </Typography>
              </Box>
              <Typography sx={{ ...BODY, maxWidth: 320, '@media (max-width: 720px)': { mt: '22px', maxWidth: '100%' } }}>
                Выбирай, как играть.
                <br />
                Moru подстроится под твою историю.
              </Typography>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '23px',
                '@media (max-width: 720px)': { gridTemplateColumns: '1fr', gap: '14px' },
              }}
            >
              {FORMATS.map(({ num, Icon, title, text, tag, featured }) => (
                <Box
                  key={title}
                  component="article"
                  sx={{
                    minHeight: 310,
                    border: `1px solid ${featured ? L.accentBorder : L.border}`,
                    p: '29px 29px 25px',
                    position: 'relative',
                    background: featured ? L.elevated : L.surface,
                    overflow: 'hidden',
                    transition: 'transform .25s, border-color .25s',
                    '&:hover': { transform: 'translateY(-5px)', borderColor: L.accent },
                    '@media (max-width: 1000px)': { p: '24px 20px' },
                    '@media (max-width: 720px)': { minHeight: 0, p: '26px' },
                  }}
                >
                  <Box sx={{ position: 'absolute', right: 22, top: 23, fontFamily: L.serif, fontStyle: 'italic', fontSize: 16, color: L.quiet }}>{num}</Box>
                  <Box sx={{ color: L.accent, mb: '30px' }}>
                    <Icon size={44} />
                  </Box>
                  <Typography component="h3" sx={{ ...H3, mb: '14px', '@media (max-width: 720px)': { fontSize: 25 } }}>
                    {title}
                  </Typography>
                  <Typography sx={{ ...BODY, maxWidth: 280, color: featured ? L.text : L.muted, '@media (max-width: 720px)': { maxWidth: 'none' } }}>{text}</Typography>
                  <Box sx={{ mt: '27px', fontSize: 11, letterSpacing: '1.7px', textTransform: 'uppercase', color: L.accent, '@media (max-width: 720px)': { mt: '18px' } }}>{tag}</Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Section>

        {/* --------------------------------------------------------------- modes */}
        <Box component="section" id="modes" sx={{ pt: '50px', pb: '95px', position: 'relative', '@media (max-width: 720px)': { pt: 0, pb: '65px' } }}>
          <Box
            sx={{
              ...WRAP,
              display: 'grid',
              gridTemplateColumns: '.9fr 1.1fr',
              gap: '75px',
              alignItems: 'center',
              '@media (max-width: 1000px)': { gap: '35px' },
              '@media (max-width: 720px)': { gridTemplateColumns: '1fr', gap: '15px' },
            }}
          >
            <Box
              sx={{
                height: 660,
                position: 'relative',
                overflow: 'hidden',
                maskImage: 'linear-gradient(0deg, transparent, black 14%, black 83%, transparent)',
                WebkitMaskImage: 'linear-gradient(0deg, transparent, black 14%, black 83%, transparent)',
                '@media (max-width: 1000px)': { height: 580 },
                '@media (max-width: 720px)': { height: 380, maxWidth: 360, width: '100%', mx: 'auto' },
                '&:after': { content: '""', position: 'absolute', inset: 0, boxShadow: `inset 0 0 48px 26px ${L.page}`, borderRadius: '48% 48% 0 0' },
              }}
            >
              <Box
                component="img"
                src={GUIDE_IMAGE}
                alt="Механический кот-волшебник Moru с парящими магическими кубиками"
                loading="lazy"
                width={640}
                height={660}
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: '50% 46%',
                  borderRadius: '48% 48% 10% 10%',
                  '@media (max-width: 720px)': { objectPosition: '50% 34%' },
                }}
              />
            </Box>
            <Box>
              <Eyebrow>Твой проводник в новые миры</Eyebrow>
              <Typography component="h2" sx={H2}>
                Начни просто.
                <br />
                Настрой глубоко,
                <br />
                когда захочешь.
              </Typography>
              <Typography sx={{ ...BODY, m: '22px 0 27px' }}>
                Первая история или сотая кампания?
                <br />
                Выбирай удобный способ старта.
              </Typography>
              {[
                {
                  Icon: BoltIcon,
                  small: 'Для первого приключения',
                  title: 'Быстрый старт',
                  text: 'Минимум настроек — и ты в истории. Все ключевые возможности Moru рядом, когда они понадобятся.',
                  cta: 'Выбрать быстрый старт',
                },
                {
                  Icon: SlidersIcon,
                  small: 'Для опытных ролееров',
                  title: 'Своя игра',
                  text: 'Управляй мирами, персонажами, памятью, AI-моделями и стилем повествования. Больше контроля над каждой деталью.',
                  cta: 'Выбрать свою игру',
                },
              ].map(({ Icon, small, title, text, cta }) => (
                <Box
                  key={title}
                  component="article"
                  sx={{
                    py: '23px',
                    borderTop: `1px solid ${L.border}`,
                    display: 'grid',
                    gridTemplateColumns: '38px 1fr',
                    gap: '15px',
                    '@media (max-width: 720px)': { gridTemplateColumns: '30px 1fr', gap: '10px' },
                  }}
                >
                  <Box sx={{ color: L.accent, pt: '4px' }}>
                    <Icon size={26} />
                  </Box>
                  <Box>
                    <Box sx={{ fontSize: 11, letterSpacing: '1.5px', mb: '7px', textTransform: 'uppercase', color: L.quiet }}>{small}</Box>
                    <Typography component="h3" sx={{ ...H3, fontSize: 25, mb: '8px' }}>
                      {title}
                    </Typography>
                    <Typography sx={BODY}>{text}</Typography>
                    <Box
                      component="button"
                      type="button"
                      onClick={() => openAuthPage('register')}
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        mt: '13px',
                        fontSize: 14,
                        fontWeight: 700,
                        fontFamily: L.ui,
                        color: L.accent,
                        border: 0,
                        background: 'none',
                        p: 0,
                        cursor: 'pointer',
                        '&:focus-visible': { outline: `3px solid ${L.accent}`, outlineOffset: 4 },
                      }}
                    >
                      {cta} <ArrowUpRightIcon size={16} />
                    </Box>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>

        {/* ------------------------------------------------- NEW: beginners + veterans */}
        <Section id="audience" sx={{ pt: 0 }}>
          <Box sx={WRAP}>
            <Box sx={{ borderTop: `1px solid ${L.border}`, pt: '50px' }}>
              <Eyebrow>Для тех, кто только начинает — и для тех, кто давно в деле</Eyebrow>
              <Typography component="h2" sx={{ ...H2, maxWidth: 780 }}>
                Первая история и сотая кампания живут здесь одинаково хорошо.
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '23px',
                  mt: '45px',
                  '@media (max-width: 720px)': { gridTemplateColumns: '1fr', gap: '14px' },
                }}
              >
                {[
                  {
                    Icon: StairsIcon,
                    tag: 'Новичкам',
                    title: 'Не нужно ничего знать заранее',
                    text: 'Не играл в текстовые РП? Просто напиши, что делает твой герой — обычными словами. Мастер сам опишет сцену, отыграет остальных и подскажет, что можно дальше. Никаких правил, которые надо учить перед первым ходом.',
                    points: ['Готовые миры сообщества — заходи и играй', 'Подсказки по ходу, а не инструкция на 20 страниц', 'Нет «неправильных» действий'],
                  },
                  {
                    Icon: SlidersIcon,
                    tag: 'Продвинутым',
                    title: 'Столько контроля, сколько захочешь',
                    text: 'Карточки мира, персонажей, правил и сюжета. Инструкции рассказчику, выбор AI-модели под сцену, ручное управление памятью, D&D-механики с бросками и характеристиками. Всё это ждёт, когда дорастёшь.',
                    points: ['Свои промпты и стиль повествования', 'Модель под каждую сцену — от бюджетной до премиальной', 'Ручная правка памяти и хроники мира'],
                  },
                ].map(({ Icon, tag, title, text, points }) => (
                  <Box
                    key={tag}
                    component="article"
                    sx={{
                      border: `1px solid ${L.border}`,
                      background: L.surface,
                      p: '29px',
                      transition: 'border-color .25s, transform .25s',
                      '&:hover': { borderColor: L.accent, transform: 'translateY(-5px)' },
                      '@media (max-width: 720px)': { p: '26px' },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '13px', mb: '20px', color: L.accent }}>
                      <Icon size={30} />
                      <Box sx={{ fontSize: 11, letterSpacing: '1.7px', textTransform: 'uppercase', fontWeight: 700 }}>{tag}</Box>
                    </Box>
                    <Typography component="h3" sx={{ ...H3, fontSize: 25, mb: '13px' }}>
                      {title}
                    </Typography>
                    <Typography sx={BODY}>{text}</Typography>
                    <Stack component="ul" spacing={0} sx={{ listStyle: 'none', m: '20px 0 0', p: 0 }}>
                      {points.map((point) => (
                        <Box component="li" key={point} sx={{ ...BODY, py: '9px', borderTop: `1px solid ${L.border}`, display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                          <Box sx={{ color: L.accent, pt: '5px' }}>
                            <SparkIcon size={12} />
                          </Box>
                          <span>{point}</span>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        </Section>

        {/* --------------------------------------------------------------- pricing */}
        <Box
          component="section"
          id="pricing"
          sx={{
            position: 'relative',
            background: L.deepArt,
            color: L.title,
            p: '101px 0 115px',
            '@media (max-width: 720px)': { p: '75px 0 85px' },
          }}
        >
          <TornEdge place="top" />
          <Box sx={WRAP}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: '50px', mb: '45px', '@media (max-width: 720px)': { display: 'block', mb: '30px' } }}>
              <Box>
                <Eyebrow tone="accent">Большие истории. Твой бюджет.</Eyebrow>
                <Typography component="h2" sx={H2}>
                  Магия без
                  <br />
                  лишних затрат.
                </Typography>
                <Typography sx={{ ...BODY, maxWidth: 440, mt: '20px' }}>
                  Выбирай AI-модель под задачу и комфортную стоимость. Не каждой сцене нужна самая дорогая модель.
                </Typography>
              </Box>
              <Box sx={{ alignSelf: 'center', whiteSpace: 'nowrap', '@media (max-width: 720px)': { mt: '30px' } }}>
                <Box sx={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '3px', mb: '16px', color: L.muted }}>Стоимость одного хода</Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', fontFamily: L.serif, fontSize: 84, lineHeight: 1, color: L.accent, '@media (max-width: 720px)': { fontSize: 68 } }}>
                  <Box component="span" sx={{ fontSize: 25 }}>
                    от
                  </Box>
                  1
                  <SolMark size={44} />
                  <Box component="span" sx={{ fontSize: 25 }}>
                    сола
                  </Box>
                </Box>
              </Box>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                border: `1px solid ${L.accentBorder}`,
                '@media (max-width: 720px)': { gridTemplateColumns: '1fr' },
              }}
            >
              {TIERS.map((tier, index) => (
                <Box
                  key={tier.title}
                  component="article"
                  sx={{
                    p: '31px 30px',
                    borderLeft: index === 0 ? 0 : `1px solid ${L.accentBorder}`,
                    '@media (max-width: 720px)': { p: '25px', borderLeft: 0, borderTop: index === 0 ? 0 : `1px solid ${L.accentBorder}` },
                  }}
                >
                  <Box sx={{ fontSize: 11, letterSpacing: '2px', color: L.accent }}>{tier.label}</Box>
                  <Typography component="h3" sx={{ ...H3, fontSize: 25, m: '18px 0 12px' }}>
                    {tier.title}
                  </Typography>
                  <Typography sx={BODY}>{tier.text}</Typography>
                </Box>
              ))}
            </Box>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '30px',
                mt: '30px',
                fontSize: 14,
                color: L.muted,
                '@media (max-width: 720px)': { alignItems: 'start', flexDirection: 'column' },
              }}
            >
              <Typography sx={{ fontFamily: L.ui, fontSize: 14, lineHeight: 1.75 }}>
                <Box component="strong" sx={{ color: L.title, fontWeight: 400 }}>
                  Подписки и пакеты солов
                </Box>
                <br />
                Выбирай удобный объём игры. Стоимость зависит от модели.
              </Typography>
              <Action variant="ghost" onClick={() => onNavigate('/shop')}>
                О стоимости подробнее
              </Action>
            </Box>
          </Box>
        </Box>

        {/* --------------------------------------------------------------- memory */}
        <Section id="memory">
          <Box sx={WRAP}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '90px',
                alignItems: 'center',
                '@media (max-width: 1000px)': { gap: '35px' },
                '@media (max-width: 720px)': { gridTemplateColumns: '1fr', gap: '32px' },
              }}
            >
              <Box>
                <Eyebrow>Не просто следующий ответ</Eyebrow>
                <Typography component="h2" sx={H2}>
                  Мир помнит.
                  <br />
                  История продолжается.
                </Typography>
                <Typography sx={{ ...BODY, m: '24px 0' }}>
                  Старые обещания, новые союзники, последствия решений. Moru сохраняет связи и события, чтобы длинная история оставалась твоей.
                </Typography>
                <Stack component="ul" spacing={0} sx={{ listStyle: 'none', m: '23px 0 0', p: 0 }}>
                  {['Персонажи со своей историей и состоянием', 'События, которые влияют на продолжение', 'Мир, который развивается вместе с тобой'].map((item) => (
                    <Box component="li" key={item} sx={{ py: '10px', borderBottom: `1px solid ${L.border}`, fontSize: 15, display: 'flex', gap: '13px', alignItems: 'center', color: L.text }}>
                      <Box sx={{ color: L.accent }}>
                        <SparkIcon size={13} />
                      </Box>
                      {item}
                    </Box>
                  ))}
                </Stack>
              </Box>
              <Box sx={{ background: L.surfaceSolid, color: L.title, boxShadow: '0 20px 50px rgba(0,0,0,0.5)', border: `1px solid ${L.border}` }}>
                <Box sx={{ p: '16px 22px', borderBottom: `1px solid ${L.border}`, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: L.muted, gap: '12px' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Box sx={{ color: L.accent }}>
                      <SparkIcon size={12} />
                    </Box>
                    Хроники Лунной башни
                  </Box>
                  <span>Пример интерфейса</span>
                </Box>
                <Box
                  sx={{
                    height: 165,
                    background: `linear-gradient(0deg, ${L.surfaceSolid}, transparent), url('${HERO_IMAGE}') left 42%/180%`,
                    display: 'flex',
                    alignItems: 'end',
                    p: '22px',
                    color: L.accent,
                    fontFamily: L.serif,
                    fontSize: 23,
                  }}
                >
                  Глава II. Старое обещание
                </Box>
                <Box sx={{ p: '6px 26px 26px' }}>
                  <Box sx={{ fontSize: 12, color: L.accent, letterSpacing: '1px', m: '10px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <SparkIcon size={11} /> МАСТЕР ИСТОРИИ
                  </Box>
                  <Typography sx={{ fontFamily: L.serif, fontSize: 16, lineHeight: 1.75, color: L.text }}>
                    Кот узнаёт серебряный ключ в твоей ладони.
                    <br />
                    «Ты всё-таки вернулся. Хранитель башни помнит твоё обещание».
                  </Typography>
                  <Box sx={{ mt: '20px', background: 'rgba(199,231,255,0.05)', borderLeft: `2px solid ${L.accent}`, p: '13px 17px', fontSize: 14, color: L.text }}>
                    Я протягиваю ключ и спрашиваю, что изменилось.
                  </Box>
                  <Box sx={{ fontSize: 11, color: L.muted, mt: '20px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Box sx={{ color: L.accent }}>
                      <SparkIcon size={11} />
                    </Box>
                    В памяти мира: ключ · обещание · хранитель
                  </Box>
                </Box>
              </Box>
            </Box>

            {/* ------------------------------------------- NEW: the six memory stages */}
            <Box sx={{ borderTop: `1px solid ${L.border}`, pt: '50px', mt: '70px', '@media (max-width: 720px)': { pt: '32px', mt: '38px' } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: '40px', mb: '45px', '@media (max-width: 720px)': { display: 'block', mb: '29px' } }}>
                <Box>
                  <Eyebrow tone="accent">Шесть ступеней памяти</Eyebrow>
                  <Typography component="h2" sx={H2}>
                    Сотый ход помнит
                    <br />
                    первый.
                  </Typography>
                </Box>
                <Typography sx={{ ...BODY, maxWidth: 340, '@media (max-width: 720px)': { mt: '22px', maxWidth: '100%' } }}>
                  Каждый ход проходит шесть ступеней сжатия. Контекст не разрастается, а история не забывается — это то, что делает долгую кампанию возможной.
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: '18px', mb: '30px', flexWrap: 'wrap' }}>
                {[
                  { Icon: LayersIcon, label: 'Шесть ступеней оптимизации' },
                  { Icon: HourglassIcon, label: 'Заточено под долгие кампании' },
                ].map(({ Icon, label }) => (
                  <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: '11px', color: L.accent, border: `1px solid ${L.accentBorder}`, px: '16px', py: '10px', fontSize: 12, letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: 700 }}>
                    <Icon size={20} />
                    {label}
                  </Box>
                ))}
              </Box>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '23px',
                  '@media (max-width: 1000px)': { gridTemplateColumns: 'repeat(2, 1fr)' },
                  '@media (max-width: 720px)': { gridTemplateColumns: '1fr', gap: '14px' },
                }}
              >
                {MEMORY_STAGES.map((stage) => (
                  <Box
                    key={stage.num}
                    component="article"
                    sx={{
                      border: `1px solid ${L.border}`,
                      background: L.surface,
                      p: '25px 24px',
                      position: 'relative',
                      transition: 'border-color .25s, transform .25s',
                      '&:hover': { borderColor: L.accent, transform: 'translateY(-4px)' },
                    }}
                  >
                    <Box sx={{ fontFamily: L.serif, fontStyle: 'italic', fontSize: 16, color: L.accent, mb: '12px' }}>{stage.num}</Box>
                    <Typography component="h3" sx={{ ...H3, fontSize: 21, mb: '10px' }}>
                      {stage.title}
                    </Typography>
                    <Typography sx={BODY}>{stage.text}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>

            <Box
              sx={{
                borderTop: `1px solid ${L.border}`,
                pt: '50px',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '40px',
                mt: '70px',
                '@media (max-width: 720px)': { gridTemplateColumns: '1fr', gap: '25px', mt: '38px', pt: '32px' },
              }}
            >
              {EXPERIENCE.map((item) => (
                <Box component="article" key={item.title}>
                  <Typography component="h3" sx={{ ...H3, fontSize: 22, mb: '13px' }}>
                    {item.title}
                  </Typography>
                  <Typography sx={{ ...BODY, fontSize: 14 }}>{item.text}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Section>

        {/* --------------------------------------------- NEW: how far the story can go */}
        <Section id="freedom" sx={{ pt: 0 }}>
          <Box sx={WRAP}>
            <Box
              sx={{
                border: `1px solid ${L.accentBorder}`,
                background: `radial-gradient(ellipse at 12% 0%, ${L.accentSoft}, transparent 46%), ${L.surface}`,
                p: '55px 50px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '60px',
                alignItems: 'center',
                '@media (max-width: 1000px)': { gap: '35px', p: '40px 32px' },
                '@media (max-width: 720px)': { gridTemplateColumns: '1fr', gap: '26px', p: '30px 24px' },
              }}
            >
              <Box>
                <Box sx={{ color: L.accent, mb: '22px' }}>
                  <UnlockIcon size={38} />
                </Box>
                <Eyebrow tone="accent">Границы задаёшь ты</Eyebrow>
                <Typography component="h2" sx={{ ...H2, fontSize: 'clamp(30px, 3.2vw, 44px)' }}>
                  История идёт туда,
                  <br />
                  куда ты её ведёшь.
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ ...BODY, fontSize: 16 }}>
                  Мы не надстраиваем свои фильтры поверх нейросети. Единственные рамки твоей истории — те, что уже встроены в саму AI-модель, которую ты выбрал для сцены. Разные модели ведут себя по-разному, и выбор всегда остаётся за тобой.
                </Typography>
                <Stack component="ul" spacing={0} sx={{ listStyle: 'none', m: '24px 0 0', p: 0 }}>
                  {[
                    'Никаких дополнительных ограничений от платформы',
                    'Тон и жёсткость сцены задают твои инструкции рассказчику',
                    'Возрастные и правовые нормы, разумеется, остаются в силе',
                  ].map((point) => (
                    <Box component="li" key={point} sx={{ ...BODY, py: '10px', borderTop: `1px solid ${L.border}`, display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <Box sx={{ color: L.accent, pt: '5px' }}>
                        <SparkIcon size={12} />
                      </Box>
                      <span>{point}</span>
                    </Box>
                  ))}
                </Stack>
              </Box>
            </Box>
          </Box>
        </Section>

        {/* --------------------------------------------------------------- community */}
        <Box
          component="section"
          id="community"
          sx={{
            position: 'relative',
            background: `linear-gradient(90deg, rgba(0,0,0,.95), rgba(0,0,0,.62)), url('${HERO_IMAGE}') center 42%/cover`,
            color: L.title,
            p: '91px 0 101px',
            '@media (max-width: 720px)': { p: '70px 0 90px', backgroundPosition: '65% center' },
          }}
        >
          <TornEdge place="top" />
          <Box sx={WRAP}>
            <Box sx={{ maxWidth: 690 }}>
              <Eyebrow tone="accent">Истории объединяют</Eyebrow>
              <Typography component="h2" sx={{ ...H2, fontSize: 'clamp(36px, 4.6vw, 62px)', '@media (max-width: 720px)': { fontSize: 40 } }}>
                Твой мир — уникальный.
                <br />
                Ты в нём не один.
              </Typography>
              <Typography sx={{ ...BODY, maxWidth: 490, m: '22px 0 30px', color: L.text }}>
                Делись мирами, персонажами и опытом. Самые активные игроки собираются в нашем Telegram: там разборы, идеи для кампаний и первые новости обновлений.
              </Typography>
              <Box sx={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <Action onClick={() => openAuthPage('register')}>Начать свою историю</Action>
                <Action href={TELEGRAM_URL} variant="ghost" icon={<TelegramIcon size={20} />}>
                  Вступить в сообщество
                </Action>
              </Box>
              <Box sx={{ display: 'flex', gap: '45px', mt: '35px', alignItems: 'center', flexWrap: 'wrap', '@media (max-width: 720px)': { gap: '27px' } }}>
                {showcase.avatars.length > 0 ? (
                  <Box sx={{ display: 'flex' }} aria-hidden>
                    {showcase.avatars.slice(0, 6).map((url, index) => (
                      <Box
                        key={url}
                        component="img"
                        src={url}
                        alt=""
                        loading="lazy"
                        sx={{
                          height: 43,
                          width: 43,
                          borderRadius: '50%',
                          objectFit: 'cover',
                          border: `2px solid ${L.deep}`,
                          ml: index === 0 ? 0 : '-8px',
                          background: L.elevated,
                        }}
                      />
                    ))}
                  </Box>
                ) : null}
                {playersLabel ? (
                  <Box>
                    <Box sx={{ fontFamily: L.serif, fontSize: 47, color: L.accent, lineHeight: 1 }}>{playersLabel}</Box>
                    <Box sx={{ fontSize: 13, color: L.muted, mt: '9px' }}>игроков уже создают свои миры</Box>
                  </Box>
                ) : null}
                {worldsLabel ? (
                  <Box>
                    <Box sx={{ fontFamily: L.serif, fontSize: 47, color: L.accent, lineHeight: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <PeopleIcon size={34} />
                      {worldsLabel}
                    </Box>
                    <Box sx={{ fontSize: 13, color: L.muted, mt: '9px' }}>миров открыто для игры</Box>
                  </Box>
                ) : null}
              </Box>
            </Box>
          </Box>
        </Box>

        {/* --------------------------------------------------------------- faq */}
        <Section id="faq">
          <Box
            sx={{
              ...WRAP,
              display: 'grid',
              gridTemplateColumns: '.8fr 1.2fr',
              gap: '75px',
              '@media (max-width: 1000px)': { gap: '40px' },
              '@media (max-width: 720px)': { gridTemplateColumns: '1fr', gap: '17px' },
            }}
          >
            <Box>
              <Eyebrow>Перед первым шагом</Eyebrow>
              <Typography component="h2" sx={H2}>
                Есть вопросы?
                <br />
                Разберёмся.
              </Typography>
              <Typography sx={{ ...BODY, mt: '20px' }}>
                Всё, что нужно знать
                <br />
                перед новым приключением.
              </Typography>
            </Box>
            <Box>
              {FAQ_ITEMS.map((item, index) => (
                <FaqItem key={item.q} q={item.q} a={item.a} defaultOpen={index === 0} />
              ))}
            </Box>
          </Box>
        </Section>

        {/* --------------------------------------------------------------- last cta */}
        <Box component="section" sx={{ p: '60px 20px 70px', textAlign: 'center', borderTop: `1px solid ${L.border}`, '@media (max-width: 720px)': { p: '45px 18px 55px' } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '17px', color: L.accent, mb: '23px', '&:before,&:after': { content: '""', width: 70, height: '1px', background: L.accentBorder } }}>
            <SparkIcon size={18} />
          </Box>
          <Typography component="h2" sx={{ ...H2, fontSize: 44, mb: '25px', '@media (max-width: 720px)': { fontSize: 35 } }}>
            Следующая история — твоя.
          </Typography>
          <Action onClick={() => openAuthPage('register')}>{isAuthenticated ? 'Продолжить историю' : 'Начать игру'}</Action>
        </Box>
      </Box>

      <Footer onNavigate={onNavigate} />

      <Box sx={{ textAlign: 'center', pb: '28px', background: L.page }}>
        <Box
          component="a"
          href="#top"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: '9px', fontSize: 13, color: L.muted, '&:hover': { color: L.accent } }}
        >
          Вернуться к началу <ArrowUpIcon size={16} />
        </Box>
      </Box>
    </Box>
  )
}
