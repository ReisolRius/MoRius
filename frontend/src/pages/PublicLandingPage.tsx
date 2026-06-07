import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Box,
  Button,
  Container,
  IconButton,
  Stack,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material'
import { brandLogo } from '../assets'
import heroNewBg from '../assets/images/landing-hero-rebrand.webp'
import characterAboutImg from '../assets/images/character-about.webp'
import slideTemplatesPreview from '../assets/images/advantages/slide-templates.png'
import advantageAvatarsPreview from '../assets/images/advantages/avatars-preview.png'
import advantageStorytellersPreview from '../assets/images/advantages/storytellers-preview.png'
import advantageImagesPreview from '../assets/images/advantages/images-preview.png'
import advantageCommunityPreview from '../assets/images/advantages/community-preview.png'
import advantageMemoryPreview from '../assets/images/advantages/memory-preview.png'
import pkgPutnikImg from '../assets/images/packages/putnik.png'
import pkgIskateltImg from '../assets/images/packages/iskatel.png'
import pkgKhronistImg from '../assets/images/packages/khronist.png'
import landingLikeIcon from '../assets/icons/landing-like.svg'
import landingGearIcon from '../assets/icons/landing-gear.svg'
import landingPlayIcon from '../assets/icons/landing-play.svg'
import arrowPrevIcon from '../assets/icons/landing-arrow-prev.svg'
import arrowNextIcon from '../assets/icons/landing-arrow-next.svg'
import landingCoinIcon from '../assets/icons/soul-moirus.svg'
import landingControlsIcon from '../assets/icons/landing-controls.svg'
import landingSendIcon from '../assets/icons/landing-send.svg'
import TextLimitIndicator from '../components/TextLimitIndicator'
import Footer from '../components/Footer'
import ProgressiveImage from '../components/media/ProgressiveImage'
import { listPublicCommunityWorlds } from '../services/storyApi'
import { resolveApiResourceUrl } from '../services/httpClient'
import type { StoryCommunityWorldSummary } from '../types/story'
import { buildWorldFallbackArtwork } from '../utils/worldBackground'

/* --- Constants ----------------------------------------------------------- */

const STORY_TEXT =
  'Трактирщик с грохотом ставит перед вами деревянную кружку, пена стекает по краям. «Пять медных,странник», — бурчит он. В этот момент музыка стихает, и вы чувствуете тяжелую руку на своем плече. Это один из местных наемников, и он выглядит недружелюбно.'

const LANDING_PROMPT_MAX_LENGTH = 8000

const ACCENT = '#578EEE'
const ACCENT_HOVER = '#477AD7'
const ACCENT_ICON_FILTER =
  'brightness(0) saturate(100%) invert(59%) sepia(85%) saturate(1731%) hue-rotate(194deg) brightness(97%) contrast(92%)'
const TEXT_HEADING = '#d4cdc8'
const TEXT_BODY = '#b6ada4'
const TEXT_SUBTITLE = '#c2b8af'
const CARD_BG = '#171716'
const CARD_BORDER = '#31302e'
const PREVIOUS_SLIDE_ARIA_LABEL = '\u041f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0438\u0439 \u0441\u043b\u0430\u0439\u0434'
const NEXT_SLIDE_ARIA_LABEL = '\u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0441\u043b\u0430\u0439\u0434'
const getSlideAriaLabel = (index: number) => `\u0421\u043b\u0430\u0439\u0434 ${index + 1}`
const BUY_PLAN_CTA_LABEL = '\u041a\u0443\u043f\u0438\u0442\u044c'

/* --- Data ----------------------------------------------------------------- */

type AdvantageSlide = {
  id: string
  number: string
  title: string
  description: string
  preview: string
}

const advantageSlides: AdvantageSlide[] = [
  {
    id: 'templates',
    number: '01',
    title: 'ШАБЛОНЫ КАРТОЧЕК',
    description:
      'Устали каждый раз заново прописывать персонажей и инструкции? Оставьте это в прошлом. Создавайте свои карточки персонажей и инструкций и используйте их в любой игре в два клика',
    preview: slideTemplatesPreview,
  },
  {
    id: 'avatars',
    number: '02',
    title: 'АВАТАРКИ ПЕРСОНАЖЕЙ',
    description:
      'Читать историю интересно, но для более глубокого погружения важно видеть лица героев. Мы сделали отображение диалога так, чтобы вы, почти как в мессенджере, сразу видели аватар и имя собеседника.',
    preview: advantageAvatarsPreview,
  },
  {
    id: 'storytellers',
    number: '03',
    title: 'РАССКАЗЧИКИ',
    description:
      'Мы подбираем, тестируем и оставляем только лучшие модели на роль гейм-мастера. GLM 5.0, GLM 4.7 и Gemini 3.1 Pro уже ждут, чтобы начать ваше приключение.',
    preview: advantageStorytellersPreview,
  },
  {
    id: 'images',
    number: '04',
    title: 'ГЕНЕРАЦИЯ КАРТИНОК',
    description:
      'Визуализируйте сцену и переключайтесь между разными художниками: от экономичного Flux до выразительного Nano Banano.',
    preview: advantageImagesPreview,
  },
  {
    id: 'community',
    number: '05',
    title: 'СООБЩЕСТВО',
    description:
      'Не хочется придумывать все с нуля? Делитесь персонажами, мирами и инструкциями, добавляйте к себе карточки других игроков и собирайте свою библиотеку идей.',
    preview: advantageCommunityPreview,
  },
  {
    id: 'memory',
    number: '06',
    title: 'ОПТИМИЗАЦИЯ ПАМЯТИ',
    description:
      'Надоело, что память забивается за пару ходов? Мы реализовали механизм оптимизации памяти — тратьте меньше, помните больше!',
    preview: advantageMemoryPreview,
  },
]

const featureCards = [
  {
    id: 'choice',
    title: 'Каждое решение меняет мир',
    description: 'Союзники запоминают, враги мстят, слухи расходятся. Ты строишь репутацию поступками',
    icon: landingLikeIcon,
  },
  {
    id: 'gm',
    title: 'Ты - герой. ИИ - мастер игры',
    description: 'Ты задаёшь намерение, мы создаём сцену и ведём сюжет дальше - как в настолке, только быстрее',
    icon: landingGearIcon,
  },
  {
    id: 'pay',
    title: 'Плати только за действие',
    description: 'Без подписок и переплат - только оплата за время в игре. Без скрытых условий и лишних расходов',
    icon: landingPlayIcon,
  },
]

type TariffPlan = {
  id: string
  title: string
  price: string
  coins: string
  details: string[]
  image: string
}

const tariffPlans: TariffPlan[] = [
  {
    id: 'pathfinder',
    title: 'Путник',
    price: '399 ₽',
    coins: '400',
    details: [
      'Для старта, тестовых миров и коротких кампаний.',
      'Работает с новым лимитом контекста до 64k.',
      'Один баланс на текст, изображения и эффекты.',
    ],
    image: pkgPutnikImg,
  },
  {
    id: 'seeker',
    title: 'Искатель',
    price: '1190 ₽',
    coins: '1300',
    details: [
      'Оптимален для регулярной игры и длинных сцен.',
      'Лучший баланс между ценой и запасом валюты.',
      'Один баланс на текст, изображения и эффекты.',
    ],
    image: pkgIskateltImg,
  },
  {
    id: 'chronicler',
    title: 'Архонт',
    price: '4490 ₽',
    coins: '5400',
    details: [
      'Для больших кампаний и тяжёлых сцен с запасом.',
      'Удобен, если часто используете дорогие модели.',
      'Один баланс на текст, изображения и эффекты.',
    ],
    image: pkgKhronistImg,
  },
]

const footerSocialLinks: Array<{ label: string; href: string; external?: boolean }> = [
  { label: 'Вконтакте', href: 'https://vk.com/moriusai', external: true },
  { label: 'Telegram', href: 'https://t.me/+t2ueY4x_KvE4ZWEy', external: true },
]

const footerInfoLinks: Array<{ label: string; path: string }> = [
  { label: 'Политика конфиденциальности', path: '/privacy-policy' },
  { label: 'Пользовательское соглашение', path: '/terms-of-service' },
]

const ctaButtonSx: SxProps<Theme> = {
  minWidth: 160,
  height: 48,
  borderRadius: '999px',
  px: 4,
  fontWeight: 700,
  fontSize: '1rem',
  fontFamily: '"Nunito Sans", sans-serif',
  backgroundColor: ACCENT,
  color: '#ffffff',
  boxShadow: '0 8px 20px rgba(87,142,238,0.35)',
  transition: 'transform 200ms ease, box-shadow 200ms ease, background-color 200ms ease',
  textTransform: 'none',
  '&:hover': {
    backgroundColor: ACCENT_HOVER,
    color: '#ffffff',
    transform: 'translateY(-2px)',
    boxShadow: '0 12px 28px rgba(87,142,238,0.45)',
  },
}

const sectionHeadingSx: SxProps<Theme> = {
  fontFamily: 'Roboto, sans-serif',
  fontWeight: 600,
  textTransform: 'uppercase',
  color: TEXT_HEADING,
  letterSpacing: 0,
}

/* --- RevealOnView --------------------------------------------------------- */

type RevealOnViewProps = {
  children: ReactNode
  delay?: number
  y?: number
  threshold?: number
  sx?: SxProps<Theme>
}

function RevealOnView({ children, delay = 0, y = 24, threshold = 0.18, sx }: RevealOnViewProps) {
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const node = nodeRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [threshold])

  return (
    <Box
      ref={nodeRef}
      sx={[
        {
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'translateY(0)' : `translateY(${y}px)`,
          transition: `opacity 700ms cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 700ms cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
          willChange: 'opacity, transform',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  )
}

function shuffleLandingWorlds(worlds: StoryCommunityWorldSummary[]): StoryCommunityWorldSummary[] {
  const nextWorlds = [...worlds]
  for (let i = nextWorlds.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const item = nextWorlds[i]
    nextWorlds[i] = nextWorlds[j]
    nextWorlds[j] = item
  }
  return nextWorlds
}

function LandingPublicWorldCard({
  world,
  onClick,
  decorative = false,
}: {
  world: StoryCommunityWorldSummary
  onClick: () => void
  decorative?: boolean
}) {
  const coverImageUrl = resolveApiResourceUrl(world.cover_image_url)

  return (
    <Box
      component="button"
      type="button"
      disabled={decorative}
      tabIndex={decorative ? -1 : undefined}
      onClick={decorative ? undefined : onClick}
      sx={{
        p: 0,
        border: `0.5px solid ${CARD_BORDER}`,
        borderRadius: '8px',
        overflow: 'hidden',
        backgroundColor: CARD_BG,
        color: TEXT_HEADING,
        width: { xs: 270, sm: 292, md: 324 },
        height: { xs: 380, md: 420 },
        flex: '0 0 auto',
        textAlign: 'left',
        cursor: decorative ? 'default' : 'pointer',
        boxShadow: '0 20px 48px rgba(0,0,0,0.34)',
        transition: 'transform 220ms ease, border-color 220ms ease, box-shadow 220ms ease',
        '&:hover': decorative
          ? undefined
          : {
              transform: 'translateY(-6px)',
              borderColor: 'rgba(87,142,238,0.45)',
              boxShadow: '0 26px 64px rgba(0,0,0,0.48), 0 0 28px rgba(87,142,238,0.16)',
            },
        '&:focus-visible': {
          outline: '2px solid rgba(87,142,238,0.72)',
          outlineOffset: '3px',
        },
        '&:disabled': {
          color: TEXT_HEADING,
        },
      }}
    >
      <Box
        sx={{
          position: 'relative',
          height: { xs: 188, md: 210 },
          overflow: 'hidden',
          ...(!coverImageUrl ? buildWorldFallbackArtwork(world.id) : {}),
        }}
      >
        {coverImageUrl ? (
          <Box
            component="img"
            src={coverImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: `${world.cover_position_x ?? 50}% ${world.cover_position_y ?? 50}%`,
            }}
          />
        ) : null}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(4,4,4,0.08) 0%, rgba(9,7,5,0.2) 46%, rgba(17,17,17,0.94) 100%)',
          }}
        />
        <Typography
          sx={{
            position: 'absolute',
            left: 18,
            right: 18,
            bottom: 16,
            color: '#ffffff',
            fontFamily: '"Nunito Sans", sans-serif',
            fontWeight: 900,
            fontSize: { xs: '1.42rem', md: '1.58rem' },
            lineHeight: 1.05,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textShadow: '0 3px 14px rgba(0,0,0,0.72)',
          }}
        >
          {world.title}
        </Typography>
      </Box>

      <Stack sx={{ p: { xs: 2, md: 2.25 }, gap: 1.35, height: { xs: 192, md: 210 } }}>
        <Typography
          sx={{
            color: TEXT_BODY,
            fontFamily: '"Nunito Sans", sans-serif',
            fontSize: { xs: '0.9rem', md: '0.95rem' },
            lineHeight: 1.5,
            minHeight: '4.5em',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {world.description || 'Готовый публичный мир от игроков MoRius.'}
        </Typography>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 'auto', minWidth: 0 }}>
          <Typography
            sx={{
              color: TEXT_SUBTITLE,
              fontFamily: '"Nunito Sans", sans-serif',
              fontSize: '0.82rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              pr: 1,
            }}
          >
            {world.author_name}
          </Typography>
          <Stack direction="row" alignItems="center" spacing={1.4} sx={{ color: '#ffffff', flexShrink: 0 }}>
            <Typography sx={{ fontSize: '0.84rem', fontWeight: 800, fontFamily: '"Nunito Sans", sans-serif' }}>
              ▶ {world.community_launches}
            </Typography>
            <Typography sx={{ fontSize: '0.84rem', fontWeight: 800, fontFamily: '"Nunito Sans", sans-serif' }}>
              ★ {world.community_rating_avg.toFixed(1)}
            </Typography>
          </Stack>
        </Stack>
      </Stack>
    </Box>
  )
}

/* --- Component props ------------------------------------------------------ */

type PublicLandingPageProps = {
  isAuthenticated: boolean
  pendingReferralCode?: string | null
  onNavigate: (path: string) => void
  onGoHome: () => void
}

/* --- Main Component ------------------------------------------------------- */

export default function PublicLandingPage({
  isAuthenticated,
  pendingReferralCode,
  onNavigate,
  onGoHome,
}: PublicLandingPageProps) {
  const storySectionRef = useRef<HTMLElement | null>(null)
  const openedReferralCodeRef = useRef<string | null>(null)
  const [animationStarted, setAnimationStarted] = useState(false)
  const [typedText, setTypedText] = useState('')
  const [promptText, setPromptText] = useState('')
  const [currentSlide, setCurrentSlide] = useState(0)
  const [currentFeatureSlide, setCurrentFeatureSlide] = useState(0)
  const [currentPlanSlide, setCurrentPlanSlide] = useState(1)
  const [publicWorlds, setPublicWorlds] = useState<StoryCommunityWorldSummary[]>([])

  /* Story typewriter */
  useEffect(() => {
    const node = storySectionRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { setAnimationStarted(true); observer.disconnect() }
      },
      { threshold: 0.2 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!animationStarted || typedText.length >= STORY_TEXT.length) return
    const nextChar = STORY_TEXT[typedText.length]
    const delay = /[,.!?]/.test(nextChar) ? 90 : nextChar === ' ' ? 14 : 20
    const id = window.setTimeout(() => {
      setTypedText(STORY_TEXT.slice(0, typedText.length + 1))
    }, delay)
    return () => window.clearTimeout(id)
  }, [animationStarted, typedText])

  useEffect(() => {
    let active = true
    void listPublicCommunityWorlds({ limit: 24, sort: 'updated_desc' })
      .then((worlds) => {
        if (!active) {
          return
        }
        setPublicWorlds(shuffleLandingWorlds(worlds).slice(0, 12))
      })
      .catch(() => {
        if (active) {
          setPublicWorlds([])
        }
      })
    return () => {
      active = false
    }
  }, [])

  const isTyping = animationStarted && typedText.length < STORY_TEXT.length

  useEffect(() => {
    if (isAuthenticated || !pendingReferralCode || openedReferralCodeRef.current === pendingReferralCode) {
      return
    }
    openedReferralCodeRef.current = pendingReferralCode
    const timerId = window.setTimeout(() => {
      onNavigate('/auth?mode=register')
    }, 0)
    return () => window.clearTimeout(timerId)
  }, [isAuthenticated, onNavigate, pendingReferralCode])

  const openAuthPage = (mode: 'login' | 'register') => {
    if (isAuthenticated) { onGoHome(); return }
    onNavigate(`/auth?mode=${mode}`)
  }

  const handlePrevSlide = () => setCurrentSlide((i) => Math.max(0, i - 1))
  const handleNextSlide = () => setCurrentSlide((i) => Math.min(advantageSlides.length - 1, i + 1))
  const handlePrevFeatureSlide = () => setCurrentFeatureSlide((i) => Math.max(0, i - 1))
  const handleNextFeatureSlide = () => setCurrentFeatureSlide((i) => Math.min(featureCards.length - 1, i + 1))
  const handlePrevPlanSlide = () => setCurrentPlanSlide((i) => Math.max(0, i - 1))
  const handleNextPlanSlide = () => setCurrentPlanSlide((i) => Math.min(tariffPlans.length - 1, i + 1))

  return (
    <Box sx={{ backgroundColor: '#111111', color: TEXT_BODY, overflowX: 'hidden' }}>

      {/* ==================================================================
          1. HERO
      ================================================================== */}
      <Box
        component="section"
        sx={{
          minHeight: '100svh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          textAlign: 'center',
          px: { xs: 2, md: 4 },
          pt: { xs: 8, md: 10 },
          pb: { xs: 10, md: 14 },
          backgroundColor: '#111111',
        }}
      >
        <ProgressiveImage
          src={heroNewBg}
          alt=""
          loading="eager"
          fetchPriority="high"
          objectFit="cover"
          objectPosition="center 54%"
          loaderSize={34}
          containerSx={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            backgroundColor: '#111111',
          }}
          imgSx={{
            objectPosition: { xs: '58% 54%', md: 'center 54%' },
            transform: 'scale(1.01)',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(4,8,18,0.2) 0%, rgba(4,8,18,0.36) 48%, rgba(17,17,17,0.98) 100%)',
            zIndex: 1,
          }}
        />
        {/* Content */}
        <Stack spacing={2.5} alignItems="center" sx={{ position: 'relative', zIndex: 3, maxWidth: 860 }}>
          <Box sx={{ position: 'relative', display: 'inline-flex', animation: 'morius-fade-up 620ms cubic-bezier(0.22,1,0.36,1) both' }}>
            <Box
              component="img"
              src={brandLogo}
              alt="Morius"
              sx={{
                width: { xs: 200, sm: 280, md: 340 },
                maxWidth: '85vw',
                display: 'block',
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                right: { xs: -18, sm: -28, md: -34 },
                top: { xs: 8, sm: 12, md: 14 },
                px: { xs: 1, md: 1.25 },
                py: 0.42,
                borderRadius: '999px',
                border: '1px solid rgba(87,142,238,0.62)',
                background: 'linear-gradient(180deg, rgba(87,142,238,0.92), rgba(53,101,196,0.92))',
                boxShadow: '0 10px 26px rgba(87,142,238,0.34)',
                color: '#ffffff',
                fontFamily: '"Nunito Sans", sans-serif',
                fontSize: { xs: '0.72rem', md: '0.82rem' },
                fontWeight: 900,
                lineHeight: 1,
                letterSpacing: 0,
              }}
            >
              2.0
            </Box>
          </Box>
          <Typography
            component="h1"
            sx={{
              ...sectionHeadingSx,
              fontSize: { xs: '1.8rem', sm: '2.4rem', md: '3rem' },
              lineHeight: 1.18,
              animation: 'morius-fade-up 680ms cubic-bezier(0.22,1,0.36,1) both',
              animationDelay: '80ms',
            }}
          >
            Твой ход. Твоя игра.{'\n'}История начинается сейчас
          </Typography>
          <Typography
            sx={{
              color: TEXT_SUBTITLE,
              fontSize: { xs: '0.9rem', md: '1.05rem' },
              fontFamily: '"Nunito Sans", sans-serif',
              fontWeight: 400,
              maxWidth: 620,
              animation: 'morius-fade-up 720ms cubic-bezier(0.22,1,0.36,1) both',
              animationDelay: '140ms',
            }}
          >
            Текстовое приключение, где ИИ ведёт игру, а ты решаешь, кем стать и как закончится история
          </Typography>
          <Box
            sx={{
              animation: 'morius-fade-up 760ms cubic-bezier(0.22,1,0.36,1) both',
              animationDelay: '200ms',
            }}
          >
            <Button variant="contained" onClick={() => openAuthPage('login')} sx={ctaButtonSx}>
              Начать играть
            </Button>
          </Box>
        </Stack>
      </Box>

      {/* ==================================================================
          2. О ПРОЕКТЕ
      ================================================================== */}
      <Box
        component="section"
        sx={{
          position: 'relative',
          background: 'linear-gradient(180deg, #111111 0%, #11151d 24%, #101216 72%, #111111 100%)',
          py: { xs: 0, md: 0 },
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse 55% 78% at 20% 54%, rgba(87,142,238,0.22) 0%, rgba(87,142,238,0.12) 42%, transparent 78%)',
            pointerEvents: 'none',
            zIndex: 0,
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: { xs: 140, md: 190 },
            background: 'linear-gradient(180deg, transparent 0%, #111111 100%)',
            pointerEvents: 'none',
            zIndex: 0,
          },
        }}
      >
        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <RevealOnView>
            <Box
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                alignItems: { xs: 'center', md: 'flex-end' },
                gap: { xs: 0, md: 0 },
                minHeight: { md: 560 },
              }}
            >
              {/* Character image full height with bottom fade */}
              <Box
                sx={{
                  flex: { md: '0 0 48%' },
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  position: 'relative',
                  pt: { xs: 4, md: 0 },
                }}
              >
                <Box
                  component="img"
                  src={characterAboutImg}
                  alt="Morius character"
                  loading="lazy"
                  decoding="async"
                  sx={{
                    width: { xs: '90%', sm: '70%', md: '100%' },
                    maxWidth: { xs: 380, md: 620 },
                    objectFit: 'contain',
                    display: 'block',
                    transform: { xs: 'translateY(8px)', md: 'translate(-4%, 16px) scale(1.08)' },
                    WebkitMaskImage: 'linear-gradient(180deg, black 55%, transparent 100%)',
                    maskImage: 'linear-gradient(180deg, black 55%, transparent 100%)',
                    filter: 'drop-shadow(0 0 40px rgba(87,142,238,0.22))',
                  }}
                />
              </Box>

              {/* Text */}
              <Stack
                spacing={2.5}
                justifyContent="center"
                sx={{
                  flex: { md: '0 0 52%' },
                  py: { xs: 5, md: 10 },
                  pl: { md: 4 },
                }}
              >
                <Typography
                  component="h2"
                  sx={{ ...sectionHeadingSx, fontSize: { xs: '1.8rem', md: '2.5rem' } }}
                >
                  О проекте
                </Typography>
                <Typography
                  sx={{
                    color: TEXT_BODY,
                    fontSize: { xs: '0.95rem', md: '1.05rem' },
                    fontFamily: '"Nunito Sans", sans-serif',
                    fontWeight: 400,
                    lineHeight: 1.7,
                  }}
                >
                  Morius AI — это текстовая MMORPG с искусственным интеллектом, где сюжет, персонажи
                  и развитие мира формируются в живом взаимодействии с игроком
                  <br /><br />
                  Проект объединяет возможности современных AI-технологий и атмосферу классических RPG,
                  создавая пространство для уникальных приключений, диалогов и нелинейных историй
                </Typography>
                <Box>
                  <Button variant="contained" onClick={() => openAuthPage('login')} sx={ctaButtonSx}>
                    Начать играть
                  </Button>
                </Box>
              </Stack>
            </Box>
          </RevealOnView>
        </Container>
      </Box>

      {/* ==================================================================
          3. ВАШЕ ПРИКЛЮЧЕНИЕ
      ================================================================== */}
      <Box
        component="section"
        ref={storySectionRef}
        sx={{
          backgroundColor: '#111111',
          py: { xs: 10, md: 14 },
          textAlign: 'center',
        }}
      >
        <Container maxWidth="md">
          <RevealOnView>
            <Typography
              component="h2"
              sx={{
                ...sectionHeadingSx,
                fontSize: { xs: '1.8rem', sm: '2.2rem', md: '2.8rem' },
                lineHeight: 1.2,
                mb: { xs: 5, md: 7 },
              }}
            >
              Ваше приключение начинается здесь и сейчас
            </Typography>
          </RevealOnView>

          <RevealOnView delay={80}>
            <Box sx={{ maxWidth: 870, mx: 'auto', textAlign: 'left' }}>
              {/* Story text box */}
              <Box
                sx={{
                  borderRadius: '12px',
                  border: `0.5px solid ${CARD_BORDER}`,
                  backgroundColor: CARD_BG,
                  p: { xs: 2.5, md: 3 },
                  minHeight: { xs: 120, md: 160 },
                  mb: 1.5,
                }}
              >
                <Typography
                  sx={{
                    color: TEXT_BODY,
                    fontSize: { xs: '0.9rem', md: '1rem' },
                    fontFamily: '"Nunito Sans", sans-serif',
                    lineHeight: 1.7,
                    minHeight: { xs: 80, md: 100 },
                  }}
                >
                  {typedText}
                  {isTyping && (
                    <Box component="span" className="typing-caret" sx={{ ml: 0.15 }}>|</Box>
                  )}
                </Typography>
              </Box>

              {/* Controls row */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  mb: 0.5,
                  px: 0.5,
                }}
              >
                {/* Coin badge */}
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 1,
                    py: 0.4,
                    borderRadius: '6px',
                    border: `0.5px solid ${CARD_BORDER}`,
                    backgroundColor: 'rgba(23,23,22,0.9)',
                  }}
                >
                  <Box component="img" src={landingCoinIcon} alt="" sx={{ width: 14, height: 14, filter: 'brightness(0) invert(1)', opacity: 0.8 }} />
                  <Typography sx={{ fontSize: '0.85rem', color: TEXT_HEADING, fontFamily: '"Nunito Sans", sans-serif', fontWeight: 500 }}>5</Typography>
                </Box>
                <Box component="img" src={landingControlsIcon} alt="controls" sx={{ height: 28, opacity: 0.75 }} />
              </Box>

              {/* Textarea row */}
              <Box
                sx={{
                  borderRadius: '12px',
                  border: `0.5px solid ${CARD_BORDER}`,
                  backgroundColor: 'rgba(23,23,22,0.9)',
                  display: 'flex',
                  alignItems: 'center',
                  px: 2,
                  py: 1.2,
                  gap: 1,
                }}
              >
                <Box
                  component="textarea"
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value.slice(0, LANDING_PROMPT_MAX_LENGTH))}
                  placeholder="Что вы будете делать дальше?"
                  rows={1}
                  sx={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    background: 'transparent',
                    color: TEXT_HEADING,
                    fontFamily: '"Nunito Sans", sans-serif',
                    fontSize: '0.9rem',
                    lineHeight: 1.5,
                    '&::placeholder': { color: '#808080', opacity: 1 },
                  }}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextLimitIndicator currentLength={promptText.length} maxLength={LANDING_PROMPT_MAX_LENGTH} />
                  <IconButton
                    size="small"
                    aria-label="send"
                    sx={{
                      width: 32,
                      height: 32,
                      backgroundColor: '#dbdde7',
                      borderRadius: '8px',
                      '&:hover': { backgroundColor: '#e8eaf0' },
                    }}
                  >
                    <Box component="img" src={landingSendIcon} alt="" sx={{ width: 14, height: 14 }} />
                  </IconButton>
                </Box>
              </Box>

              <Box sx={{ textAlign: 'center', mt: 5 }}>
                <Button variant="contained" onClick={() => openAuthPage('register')} sx={ctaButtonSx}>
                  Начать играть
                </Button>
              </Box>
            </Box>
          </RevealOnView>
        </Container>
      </Box>

      {publicWorlds.length > 0 ? (
        <Box
          component="section"
          sx={{
            position: 'relative',
            backgroundColor: '#111111',
            py: { xs: 9, md: 13 },
            overflow: 'hidden',
            '@keyframes morius-public-worlds-scroll': {
              '0%': { transform: 'translateX(0)' },
              '100%': { transform: 'translateX(-50%)' },
            },
          }}
        >
          <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 2, textAlign: 'center', mb: { xs: 4.5, md: 6 } }}>
            <RevealOnView>
              <Typography
                component="h2"
                sx={{
                  ...sectionHeadingSx,
                  fontSize: { xs: '1.8rem', sm: '2.2rem', md: '2.8rem' },
                  lineHeight: 1.14,
                }}
              >
                Публичные готовые миры
              </Typography>
              <Typography
                sx={{
                  mt: 1.5,
                  color: TEXT_BODY,
                  fontFamily: '"Nunito Sans", sans-serif',
                  fontSize: { xs: '0.95rem', md: '1.08rem' },
                  lineHeight: 1.55,
                }}
              >
                Создавай миры и делись ими, или играй в готовые созданные другими игроками!
              </Typography>
            </RevealOnView>
          </Container>

          <RevealOnView delay={80} threshold={0.08}>
            <Box
              sx={{
                position: 'relative',
                width: '100%',
                overflow: 'hidden',
                px: { xs: 0, md: 0 },
                WebkitMaskImage: {
                  xs: 'linear-gradient(90deg, transparent 0%, #000 8%, #000 92%, transparent 100%)',
                  md: 'linear-gradient(90deg, transparent 0%, #000 12%, #000 88%, transparent 100%)',
                },
                maskImage: {
                  xs: 'linear-gradient(90deg, transparent 0%, #000 8%, #000 92%, transparent 100%)',
                  md: 'linear-gradient(90deg, transparent 0%, #000 12%, #000 88%, transparent 100%)',
                },
              }}
            >
              <Box
                aria-hidden
                sx={{
                  position: 'absolute',
                  inset: { xs: '24px 0 12px', md: '32px 0 16px' },
                  display: 'flex',
                  gap: { xs: 2, md: 2.5 },
                  width: 'max-content',
                  animation: 'morius-public-worlds-scroll 44s linear infinite',
                  filter: 'blur(16px)',
                  opacity: 0.28,
                  transform: 'scale(0.96)',
                  transformOrigin: 'center',
                  pointerEvents: 'none',
                }}
              >
                {[...publicWorlds, ...publicWorlds].map((world, index) => (
                  <LandingPublicWorldCard
                    key={`public-world-blur-${world.id}-${index}`}
                    world={world}
                    onClick={() => undefined}
                    decorative
                  />
                ))}
              </Box>
              <Box
                sx={{
                  position: 'relative',
                  zIndex: 1,
                  display: 'flex',
                  gap: { xs: 2, md: 2.5 },
                  width: 'max-content',
                  animation: 'morius-public-worlds-scroll 44s linear infinite',
                  '&:hover': { animationPlayState: 'paused' },
                }}
              >
                {[...publicWorlds, ...publicWorlds].map((world, index) => (
                  <LandingPublicWorldCard
                    key={`public-world-${world.id}-${index}`}
                    world={world}
                    onClick={() => openAuthPage('register')}
                  />
                ))}
              </Box>
            </Box>
          </RevealOnView>
        </Box>
      ) : null}

      {/* ==================================================================
          4. ПРЕИМУЩЕСТВА И ОСОБЕННОСТИ
      ================================================================== */}
      <Box component="section" sx={{ backgroundColor: '#111111', py: { xs: 10, md: 14 } }}>
        <Container maxWidth="lg">
          <RevealOnView>
            <Typography
              component="h2"
              sx={{
                ...sectionHeadingSx,
                fontSize: { xs: '1.8rem', sm: '2.2rem', md: '2.8rem' },
                textAlign: 'center',
                mb: { xs: 6, md: 8 },
              }}
            >
              Преимущества и особенности
            </Typography>
          </RevealOnView>

          {/* Carousel */}
          <Box
            sx={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '520px 560px' },
              justifyContent: 'center',
              alignItems: 'center',
              gap: { xs: 4, md: 6 },
              minHeight: { xs: 'auto', md: 500 },
            }}
          >
            {/* Left: numbered slide content */}
            <Box
              sx={{
                width: '100%',
                overflow: 'hidden',
                minHeight: { xs: 'auto', md: 430 },
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  transform: `translateX(-${currentSlide * 100}%)`,
                  transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
                  willChange: 'transform',
                }}
              >
                {advantageSlides.map((item) => (
                  <Box
                    key={`text-${item.id}`}
                    sx={{
                      minWidth: '100%',
                      width: '100%',
                      flexShrink: 0,
                      position: 'relative',
                      minHeight: { xs: 'auto', md: 430 },
                      pb: { xs: 0, md: 9 },
                    }}
                  >
                    {/* Big stroke number */}
              <Typography
                aria-hidden
                sx={{
                  fontFamily: 'Roboto, Arial, sans-serif',
                  fontWeight: 700,
                  fontSize: { xs: '9rem', md: '13rem' },
                  lineHeight: 0.85,
                  WebkitTextFillColor: 'transparent',
                  WebkitTextStroke: `2px ${ACCENT}`,
                  letterSpacing: 0,
                  fontVariantNumeric: 'tabular-nums',
                  WebkitMaskImage: 'linear-gradient(180deg, #000 0%, #000 36%, rgba(0,0,0,0.28) 56%, transparent 78%)',
                  maskImage: 'linear-gradient(180deg, #000 0%, #000 36%, rgba(0,0,0,0.28) 56%, transparent 78%)',
                  userSelect: 'none',
                  mb: -2,
                  opacity: 0.9,
                }}
              >
                {item.number}
              </Typography>
              <Typography
                component="h3"
                sx={{
                  ...sectionHeadingSx,
                  fontSize: { xs: '1.3rem', md: '1.7rem' },
                  mb: 2,
                }}
              >
                {item.title}
              </Typography>
              <Typography
                sx={{
                  color: TEXT_BODY,
                  fontSize: { xs: '0.9rem', md: '1rem' },
                  fontFamily: '"Nunito Sans", sans-serif',
                  lineHeight: 1.7,
                  maxWidth: 520,
                  mb: 4,
                  opacity: 0.85,
                }}
              >
                {item.description}
              </Typography>

              {/* Navigation arrows */}
              <Box sx={{ position: 'absolute', left: 0, bottom: 38, display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 2, mb: 0 }}>
                <IconButton
                  onClick={handlePrevSlide}
                  disabled={currentSlide === 0}
                  aria-label="Предыдущее"
                  sx={{
                    p: 0,
                    width: 36,
                    height: 36,
                    backgroundColor: 'transparent',
                    border: 'none',
                    opacity: currentSlide === 0 ? 0.35 : 1,
                      transition: 'opacity 220ms ease, transform 220ms ease',
                    '&:hover:not(:disabled)': { transform: 'translateX(-2px)', backgroundColor: 'transparent' },
                  }}
                >
                  <Box
                    component="img"
                    src={arrowPrevIcon}
                    alt="prev"
                    sx={{ width: 28, filter: ACCENT_ICON_FILTER }}
                  />
                </IconButton>
                <IconButton
                  onClick={handleNextSlide}
                  disabled={currentSlide === advantageSlides.length - 1}
                  aria-label="Следующее"
                  sx={{
                    p: 0,
                    width: 36,
                    height: 36,
                    backgroundColor: 'transparent',
                    border: 'none',
                    opacity: currentSlide === advantageSlides.length - 1 ? 0.35 : 1,
                      transition: 'opacity 220ms ease, transform 220ms ease',
                    '&:hover:not(:disabled)': { transform: 'translateX(2px)', backgroundColor: 'transparent' },
                  }}
                >
                  <Box
                    component="img"
                    src={arrowNextIcon}
                    alt="next"
                    sx={{ width: 28, filter: ACCENT_ICON_FILTER }}
                  />
                </IconButton>
              </Box>

              {/* Dot indicators */}
              <Box sx={{ position: 'absolute', left: 0, bottom: 0, display: { xs: 'none', md: 'flex' }, gap: 1 }}>
                {advantageSlides.map((_, i) => (
                  <Box
                    key={i}
                    component="button"
                    onClick={() => setCurrentSlide(i)}
                    aria-label={`Слайд ${i + 1}`}
                    sx={{
                      width: i === currentSlide ? 52 : 44,
                      height: 3,
                      borderRadius: '2px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: i === currentSlide ? ACCENT : 'rgba(217,217,217,0.5)',
                      transition: 'background-color 220ms ease, width 220ms ease',
                      p: 0,
                    }}
                  />
                ))}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>

            {/* Right: preview image with accent glow */}
            <Box
              sx={{
                width: '100%',
                overflow: 'hidden',
                minHeight: { xs: 320, md: 500 },
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  transform: `translateX(-${currentSlide * 100}%)`,
                  transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
                  willChange: 'transform',
                }}
              >
                {advantageSlides.map((item) => (
                  <Box
                    key={`img-${item.id}`}
                    sx={{
                      minWidth: '100%',
                      width: '100%',
                      flexShrink: 0,
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      position: 'relative',
                      minHeight: { xs: 320, md: 500 },
                    }}
                  >
                    <Box
                      aria-hidden
                      sx={{
                        position: 'absolute',
                        inset: { xs: '10% 0 8%', md: '5% -6% 4%' },
                        background:
                          'radial-gradient(ellipse at center, rgba(87,142,238,0.2) 0%, rgba(87,142,238,0.12) 34%, rgba(87,142,238,0.05) 54%, transparent 76%)',
                        zIndex: 0,
                        pointerEvents: 'none',
                      }}
                    />
                    <Box
                      sx={{
                        position: 'relative',
                        zIndex: 1,
                        width: { xs: '85%', md: '90%' },
                        maxWidth: 560,
                        transform: 'rotate(4deg)',
                        '&::after': {
                          content: '""',
                          position: 'absolute',
                          inset: -1,
                          borderRadius: '12px',
                          background:
                            'linear-gradient(90deg, #111111 0%, transparent 13%, transparent 87%, #111111 100%), linear-gradient(180deg, #111111 0%, transparent 13%, transparent 87%, #111111 100%)',
                          pointerEvents: 'none',
                        },
                      }}
                    >
                      <Box
                        component="img"
                        src={item.preview}
                        alt={item.title}
                        loading="lazy"
                        decoding="async"
                        sx={{
                          width: '100%',
                          display: 'block',
                          borderRadius: '12px',
                          boxShadow: '0 24px 48px rgba(0,0,0,0.55), 0 0 100px rgba(87,142,238,0.14)',
                        }}
                      />
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
            <Box
              sx={{
                display: { xs: 'flex', md: 'none' },
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                width: '100%',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <IconButton
                  onClick={handlePrevSlide}
                  disabled={currentSlide === 0}
                  aria-label={PREVIOUS_SLIDE_ARIA_LABEL}
                  sx={{
                    p: 0,
                    width: 36,
                    height: 36,
                    backgroundColor: 'transparent',
                    border: 'none',
                    opacity: currentSlide === 0 ? 0.35 : 1,
                    transition: 'opacity 220ms ease, transform 220ms ease',
                    '&:hover:not(:disabled)': { transform: 'translateX(-2px)', backgroundColor: 'transparent' },
                  }}
                >
                  <Box
                    component="img"
                    src={arrowPrevIcon}
                    alt="prev"
                    sx={{ width: 28, filter: ACCENT_ICON_FILTER }}
                  />
                </IconButton>
                <IconButton
                  onClick={handleNextSlide}
                  disabled={currentSlide === advantageSlides.length - 1}
                  aria-label={NEXT_SLIDE_ARIA_LABEL}
                  sx={{
                    p: 0,
                    width: 36,
                    height: 36,
                    backgroundColor: 'transparent',
                    border: 'none',
                    opacity: currentSlide === advantageSlides.length - 1 ? 0.35 : 1,
                    transition: 'opacity 220ms ease, transform 220ms ease',
                    '&:hover:not(:disabled)': { transform: 'translateX(2px)', backgroundColor: 'transparent' },
                  }}
                >
                  <Box
                    component="img"
                    src={arrowNextIcon}
                    alt="next"
                    sx={{ width: 28, filter: ACCENT_ICON_FILTER }}
                  />
                </IconButton>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                {advantageSlides.map((_, i) => (
                  <Box
                    key={`mobile-dot-${i}`}
                    component="button"
                    onClick={() => setCurrentSlide(i)}
                    aria-label={getSlideAriaLabel(i)}
                    sx={{
                      width: i === currentSlide ? 52 : 44,
                      height: 3,
                      borderRadius: '2px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: i === currentSlide ? ACCENT : 'rgba(217,217,217,0.5)',
                      transition: 'background-color 220ms ease, width 220ms ease',
                      p: 0,
                    }}
                  />
                ))}
              </Box>
            </Box>
          </Box>
        </Container>
      </Box>

      {/* ==================================================================
          5. КАК УСТРОЕНА ИГРА
      ================================================================== */}
      <Box component="section" sx={{ backgroundColor: '#111111', py: { xs: 10, md: 14 } }}>
        <Container maxWidth="lg">
          <RevealOnView>
            <Stack spacing={1.5} alignItems="center" textAlign="center" mb={{ xs: 5, md: 7 }}>
              <Typography
                component="h2"
                sx={{ ...sectionHeadingSx, fontSize: { xs: '1.8rem', md: '2.5rem' } }}
              >
                Как устроена игра
              </Typography>
              <Typography
                sx={{
                  color: TEXT_BODY,
                  fontFamily: '"Nunito Sans", sans-serif',
                  fontSize: { xs: '0.9rem', md: '1rem' },
                  maxWidth: 720,
                }}
              >
                Ты выбираешь действия. ИИ ведет мир: описывает сцены, персонажей и последствия
              </Typography>
            </Stack>
          </RevealOnView>

          <RevealOnView delay={60} sx={{ display: { xs: 'block', sm: 'none' } }}>
            <Box sx={{ overflow: 'hidden' }}>
              <Box
                sx={{
                  display: 'flex',
                  transform: `translateX(-${currentFeatureSlide * 100}%)`,
                  transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
                  willChange: 'transform',
                }}
              >
                {featureCards.map((card) => (
                  <Box key={`mobile-feature-${card.id}`} sx={{ minWidth: '100%', width: '100%', flexShrink: 0 }}>
                    <Box
                      sx={{
                        backgroundColor: CARD_BG,
                        border: `0.5px solid ${CARD_BORDER}`,
                        borderRadius: '12px',
                        p: 3,
                        minHeight: 180,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 2,
                        }}
                      >
                        <Typography
                          component="h3"
                          sx={{
                            fontFamily: '"Nunito Sans", sans-serif',
                            fontWeight: 700,
                            fontSize: '1rem',
                            color: TEXT_HEADING,
                            lineHeight: 1.3,
                          }}
                        >
                          {card.title}
                        </Typography>
                        <Box
                          component="img"
                          src={card.icon}
                          alt=""
                          sx={{
                            width: 40,
                            height: 40,
                            flexShrink: 0,
                            filter: ACCENT_ICON_FILTER,
                          }}
                        />
                      </Box>
                      <Typography
                        sx={{
                          color: TEXT_BODY,
                          fontFamily: '"Nunito Sans", sans-serif',
                          fontSize: '0.85rem',
                          lineHeight: 1.6,
                          opacity: 0.82,
                        }}
                      >
                        {card.description}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, mt: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <IconButton
                  onClick={handlePrevFeatureSlide}
                  disabled={currentFeatureSlide === 0}
                  aria-label={PREVIOUS_SLIDE_ARIA_LABEL}
                  sx={{
                    p: 0,
                    width: 36,
                    height: 36,
                    backgroundColor: 'transparent',
                    border: 'none',
                    opacity: currentFeatureSlide === 0 ? 0.35 : 1,
                    transition: 'opacity 220ms ease, transform 220ms ease',
                    '&:hover:not(:disabled)': { transform: 'translateX(-2px)', backgroundColor: 'transparent' },
                  }}
                >
                  <Box
                    component="img"
                    src={arrowPrevIcon}
                    alt="prev"
                    sx={{ width: 28, filter: ACCENT_ICON_FILTER }}
                  />
                </IconButton>
                <IconButton
                  onClick={handleNextFeatureSlide}
                  disabled={currentFeatureSlide === featureCards.length - 1}
                  aria-label={NEXT_SLIDE_ARIA_LABEL}
                  sx={{
                    p: 0,
                    width: 36,
                    height: 36,
                    backgroundColor: 'transparent',
                    border: 'none',
                    opacity: currentFeatureSlide === featureCards.length - 1 ? 0.35 : 1,
                    transition: 'opacity 220ms ease, transform 220ms ease',
                    '&:hover:not(:disabled)': { transform: 'translateX(2px)', backgroundColor: 'transparent' },
                  }}
                >
                  <Box
                    component="img"
                    src={arrowNextIcon}
                    alt="next"
                    sx={{ width: 28, filter: ACCENT_ICON_FILTER }}
                  />
                </IconButton>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                {featureCards.map((_, i) => (
                  <Box
                    key={`feature-dot-${i}`}
                    component="button"
                    onClick={() => setCurrentFeatureSlide(i)}
                    aria-label={getSlideAriaLabel(i)}
                    sx={{
                      width: i === currentFeatureSlide ? 52 : 44,
                      height: 3,
                      borderRadius: '2px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: i === currentFeatureSlide ? ACCENT : 'rgba(217,217,217,0.5)',
                      transition: 'background-color 220ms ease, width 220ms ease',
                      p: 0,
                    }}
                  />
                ))}
              </Box>
            </Box>
          </RevealOnView>

          <Box
            sx={{
              display: { xs: 'none', sm: 'grid' },
              gridTemplateColumns: { sm: 'repeat(2,1fr)', md: 'repeat(3,1fr)' },
              gap: 2,
            }}
          >
            {featureCards.map((card, i) => (
              <RevealOnView key={card.id} delay={i * 80} y={28}>
                <Box
                  sx={{
                    backgroundColor: CARD_BG,
                    border: `0.5px solid ${CARD_BORDER}`,
                    borderRadius: '12px',
                    p: 3,
                    height: '100%',
                    minHeight: 180,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    transition: 'border-color 240ms ease, transform 240ms ease',
                    '&:hover': {
                      borderColor: 'rgba(49,48,46,0.8)',
                      transform: 'translateY(-4px)',
                    },
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 2,
                    }}
                  >
                    <Typography
                      component="h3"
                      sx={{
                        fontFamily: '"Nunito Sans", sans-serif',
                        fontWeight: 700,
                        fontSize: { xs: '1rem', md: '1.1rem' },
                        color: TEXT_HEADING,
                        lineHeight: 1.3,
                      }}
                    >
                      {card.title}
                    </Typography>
                    <Box
                      component="img"
                      src={card.icon}
                      alt=""
                      sx={{
                        width: 40,
                        height: 40,
                        flexShrink: 0,
                        filter: ACCENT_ICON_FILTER,
                      }}
                    />
                  </Box>
                  <Typography
                    sx={{
                      color: TEXT_BODY,
                      fontFamily: '"Nunito Sans", sans-serif',
                      fontSize: '0.85rem',
                      lineHeight: 1.6,
                      opacity: 0.82,
                    }}
                  >
                    {card.description}
                  </Typography>
                </Box>
              </RevealOnView>
            ))}
          </Box>
        </Container>
      </Box>

      {/* ==================================================================
          6. ПАКЕТЫ
      ================================================================== */}
      <Box component="section" sx={{ backgroundColor: '#111111', py: { xs: 10, md: 14 } }}>
        <Container maxWidth="lg">
          <RevealOnView>
            <Typography
              component="h2"
              sx={{ ...sectionHeadingSx, fontSize: { xs: '1.8rem', md: '2.5rem' }, textAlign: 'center', mb: { xs: 5, md: 7 } }}
            >
              Пакеты
            </Typography>
          </RevealOnView>

          {/* Бесплатный старт banner */}
          <RevealOnView delay={60}>
            <Box
              sx={{
                borderRadius: '12px',
                overflow: 'hidden',
                border: `0.5px solid ${CARD_BORDER}`,
                mb: 2.5,
              }}
            >
              {/* Accent header */}
              <Box sx={{ backgroundColor: ACCENT, px: 3, py: 1.8 }}>
                <Typography
                  sx={{
                    fontFamily: '"Nunito Sans", sans-serif',
                    fontWeight: 700,
                    fontSize: { xs: '1rem', md: '1.15rem' },
                    color: '#ffffff',
                  }}
                >
                  Бесплатный старт
                </Typography>
              </Box>
              {/* Body */}
              <Box
                sx={{
                  backgroundColor: CARD_BG,
                  px: 3,
                  py: 2.5,
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 3,
                  flexWrap: 'wrap',
                }}
              >
                <Stack spacing={0.6}>
                  <Typography sx={{ color: TEXT_BODY, fontFamily: '"Nunito Sans", sans-serif', fontSize: '0.9rem' }}>~50 ходов</Typography>
                  <Typography sx={{ color: TEXT_BODY, fontFamily: '"Nunito Sans", sans-serif', fontSize: '0.9rem' }}>
                    Доступ ко всем функциям и рассказчикам
                  </Typography>
                  <Typography sx={{ color: TEXT_BODY, fontFamily: '"Nunito Sans", sans-serif', fontSize: '0.9rem' }}>
                    Отличная возможность опробовать сайт и принять решение о покупке
                  </Typography>
                </Stack>
                <Typography
                  sx={{
                    fontFamily: '"Nunito Sans", sans-serif',
                    fontWeight: 700,
                    fontSize: { xs: '2rem', md: '2.5rem' },
                    color: '#ffffff',
                    whiteSpace: 'nowrap',
                    lineHeight: 1,
                  }}
                >
                  0 ₽
                </Typography>
              </Box>
              </Box>
          </RevealOnView>

          {/* Paid packages */}
          <RevealOnView delay={100} sx={{ display: { xs: 'block', sm: 'none' } }}>
            <Box sx={{ overflow: 'hidden' }}>
              <Box
                sx={{
                  display: 'flex',
                  transform: `translateX(-${currentPlanSlide * 100}%)`,
                  transition: 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
                  willChange: 'transform',
                }}
              >
                {tariffPlans.map((plan) => (
                  <Box key={`mobile-plan-${plan.id}`} sx={{ minWidth: '100%', width: '100%', flexShrink: 0 }}>
                    <Box
                      sx={{
                        backgroundColor: CARD_BG,
                        border: `0.5px solid ${CARD_BORDER}`,
                        borderRadius: '12px',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      <Box
                        sx={{
                          position: 'relative',
                          height: 120,
                          overflow: 'hidden',
                          backgroundColor: '#151515',
                        }}
                      >
                        <ProgressiveImage
                          src={plan.image}
                          alt=""
                          loading="lazy"
                          objectFit="cover"
                          objectPosition="center"
                          loaderSize={22}
                          containerSx={{ position: 'absolute', inset: 0 }}
                        />
                        <Box
                          aria-hidden
                          sx={{
                            position: 'absolute',
                            inset: 0,
                            background: 'linear-gradient(180deg, rgba(17,17,17,0.05) 0%, rgba(17,17,17,0.45) 100%)',
                            zIndex: 1,
                          }}
                        />
                        <Typography
                          sx={{
                            position: 'absolute',
                            zIndex: 2,
                            bottom: 12,
                            left: 16,
                            fontFamily: '"Nunito Sans", sans-serif',
                            fontWeight: 900,
                            fontSize: '2rem',
                            lineHeight: 1,
                            color: '#ffffff',
                            textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                          }}
                        >
                          {plan.title}
                        </Typography>
                      </Box>

                      <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1 }}>
                        <Typography
                          sx={{
                            fontFamily: '"Nunito Sans", sans-serif',
                            fontWeight: 700,
                            fontSize: '2rem',
                            color: '#ffffff',
                            lineHeight: 1.1,
                          }}
                        >
                          {plan.price}
                        </Typography>
                        <Stack direction="row" spacing={0.45} alignItems="center">
                          <Typography sx={{ color: TEXT_BODY, fontFamily: '"Nunito Sans", sans-serif', fontSize: '0.9rem' }}>
                            {plan.coins}
                          </Typography>
                          <Box component="img" src={landingCoinIcon} alt="" sx={{ width: 9, height: 14, opacity: 0.88 }} />
                        </Stack>
                        <Stack spacing={0.5} sx={{ flex: 1 }}>
                          {plan.details.map((d, j) => (
                            <Typography key={j} sx={{ color: TEXT_BODY, fontFamily: '"Nunito Sans", sans-serif', fontSize: '0.82rem', lineHeight: 1.5 }}>
                              {d}
                            </Typography>
                          ))}
                        </Stack>
                        <Button
                          variant="contained"
                          onClick={() => openAuthPage('register')}
                          sx={{ ...ctaButtonSx, width: '100%', mt: 1 }}
                        >
                          {BUY_PLAN_CTA_LABEL}
                        </Button>
                      </Box>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, mt: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <IconButton
                  onClick={handlePrevPlanSlide}
                  disabled={currentPlanSlide === 0}
                  aria-label={PREVIOUS_SLIDE_ARIA_LABEL}
                  sx={{
                    p: 0,
                    width: 36,
                    height: 36,
                    backgroundColor: 'transparent',
                    border: 'none',
                    opacity: currentPlanSlide === 0 ? 0.35 : 1,
                    transition: 'opacity 220ms ease, transform 220ms ease',
                    '&:hover:not(:disabled)': { transform: 'translateX(-2px)', backgroundColor: 'transparent' },
                  }}
                >
                  <Box
                    component="img"
                    src={arrowPrevIcon}
                    alt="prev"
                    sx={{ width: 28, filter: ACCENT_ICON_FILTER }}
                  />
                </IconButton>
                <IconButton
                  onClick={handleNextPlanSlide}
                  disabled={currentPlanSlide === tariffPlans.length - 1}
                  aria-label={NEXT_SLIDE_ARIA_LABEL}
                  sx={{
                    p: 0,
                    width: 36,
                    height: 36,
                    backgroundColor: 'transparent',
                    border: 'none',
                    opacity: currentPlanSlide === tariffPlans.length - 1 ? 0.35 : 1,
                    transition: 'opacity 220ms ease, transform 220ms ease',
                    '&:hover:not(:disabled)': { transform: 'translateX(2px)', backgroundColor: 'transparent' },
                  }}
                >
                  <Box
                    component="img"
                    src={arrowNextIcon}
                    alt="next"
                    sx={{ width: 28, filter: ACCENT_ICON_FILTER }}
                  />
                </IconButton>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                {tariffPlans.map((_, i) => (
                  <Box
                    key={`plan-dot-${i}`}
                    component="button"
                    onClick={() => setCurrentPlanSlide(i)}
                    aria-label={getSlideAriaLabel(i)}
                    sx={{
                      width: i === currentPlanSlide ? 52 : 44,
                      height: 3,
                      borderRadius: '2px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: i === currentPlanSlide ? ACCENT : 'rgba(217,217,217,0.5)',
                      transition: 'background-color 220ms ease, width 220ms ease',
                      p: 0,
                    }}
                  />
                ))}
              </Box>
            </Box>
          </RevealOnView>

          <Box
            sx={{
              display: { xs: 'none', sm: 'grid' },
              gridTemplateColumns: { sm: 'repeat(2,1fr)', md: 'repeat(3,1fr)' },
              gap: 2,
            }}
          >
            {tariffPlans.map((plan, i) => (
              <RevealOnView key={plan.id} delay={i * 80 + 100} y={28}>
                <Box
                  sx={{
                    backgroundColor: CARD_BG,
                    border: `0.5px solid ${CARD_BORDER}`,
                    borderRadius: '12px',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'transform 240ms ease, border-color 240ms ease',
                    '&:hover': { transform: 'translateY(-6px)', borderColor: 'rgba(87,142,238,0.3)' },
                  }}
                >
                  {/* Package image header */}
                  <Box
                    sx={{
                      position: 'relative',
                      height: { xs: 120, md: 140 },
                      overflow: 'hidden',
                      backgroundColor: '#151515',
                    }}
                  >
                    <ProgressiveImage
                      src={plan.image}
                      alt=""
                      loading="lazy"
                      objectFit="cover"
                      objectPosition="center"
                      loaderSize={22}
                      containerSx={{ position: 'absolute', inset: 0 }}
                    />
                    <Box
                      aria-hidden
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        background: 'linear-gradient(180deg, rgba(17,17,17,0.05) 0%, rgba(17,17,17,0.45) 100%)',
                        zIndex: 1,
                      }}
                    />
                    <Typography
                      sx={{
                        position: 'absolute',
                        zIndex: 2,
                        bottom: 12,
                        left: 16,
                        fontFamily: '"Nunito Sans", sans-serif',
                        fontWeight: 900,
                        fontSize: '2rem',
                        lineHeight: 1,
                        color: '#ffffff',
                        textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                      }}
                    >
                      {plan.title}
                    </Typography>
                  </Box>

                  {/* Package content */}
                  <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1 }}>
                    <Typography
                      sx={{
                        fontFamily: '"Nunito Sans", sans-serif',
                        fontWeight: 700,
                        fontSize: { xs: '2rem', md: '2.4rem' },
                        color: '#ffffff',
                        lineHeight: 1.1,
                      }}
                    >
                      {plan.price}
                    </Typography>
                    <Stack direction="row" spacing={0.45} alignItems="center">
                      <Typography sx={{ color: TEXT_BODY, fontFamily: '"Nunito Sans", sans-serif', fontSize: '0.9rem' }}>
                        {plan.coins}
                      </Typography>
                      <Box component="img" src={landingCoinIcon} alt="" sx={{ width: 9, height: 14, opacity: 0.88 }} />
                    </Stack>
                    <Stack spacing={0.5} sx={{ flex: 1 }}>
                      {plan.details.map((d, j) => (
                        <Typography key={j} sx={{ color: TEXT_BODY, fontFamily: '"Nunito Sans", sans-serif', fontSize: '0.82rem', lineHeight: 1.5 }}>
                          {d}
                        </Typography>
                      ))}
                    </Stack>
                    <Button
                      variant="contained"
                      onClick={() => openAuthPage('register')}
                      sx={{ ...ctaButtonSx, width: '100%', mt: 1 }}
                    >
                      Купить
                    </Button>
                  </Box>
                </Box>
              </RevealOnView>
            ))}
          </Box>
        </Container>
      </Box>

      {/* ==================================================================
          7. ГОТОВ СДЕЛАТЬ ПЕРВЫЙ ХОД?
      ================================================================== */}
      <Box
        component="section"
        sx={{
          backgroundColor: '#111111',
          py: { xs: 10, md: 14 },
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          px: 3,
        }}
      >
        <RevealOnView>
          <Stack spacing={2} alignItems="center">
            <Typography
              component="h2"
              sx={{ ...sectionHeadingSx, fontSize: { xs: '1.8rem', md: '2.5rem' } }}
            >
              Готов сделать первый ход?
            </Typography>
            <Typography
              sx={{
                color: TEXT_BODY,
                fontFamily: '"Nunito Sans", sans-serif',
                fontSize: { xs: '0.9rem', md: '1rem' },
              }}
            >
              Зарегистрируйся и начни играть
            </Typography>
            <Box sx={{ pt: 1 }}>
              <Button variant="contained" onClick={() => openAuthPage('register')} sx={ctaButtonSx}>
                Начать играть
              </Button>
            </Box>
          </Stack>
        </RevealOnView>
      </Box>

      {/* ==================================================================
          8. FOOTER
      ================================================================== */}
      <Footer socialLinks={footerSocialLinks} infoLinks={footerInfoLinks} onNavigate={onNavigate} />

    </Box>
  )
}
