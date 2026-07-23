import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  Box,
  Button,
  Container,
  Stack,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material'
import { brandLogo } from '../assets'
import slideTemplatesPreview from '../assets/images/advantages/slide-templates.png'
import advantageAvatarsPreview from '../assets/images/advantages/avatars-preview.png'
import advantageStorytellersPreview from '../assets/images/advantages/storytellers-preview.png'
import advantageImagesPreview from '../assets/images/advantages/images-preview.png'
import advantageCommunityPreview from '../assets/images/advantages/community-preview.png'
import advantageMemoryPreview from '../assets/images/advantages/memory-preview.png'
import heroSkyImg from '../assets/images/presentation/hero-sky.jpg'
import heroWandererImg from '../assets/images/presentation/hero-wanderer.png'
import heroCliffImg from '../assets/images/presentation/hero-cliff.png'
import aboutCavernImg from '../assets/images/presentation/about-cavern.png'
import underwaterCavernImg from '../assets/images/presentation/underwater-cavern.png'
import dragonDepthsImg from '../assets/images/presentation/dragon-depths.png'
import ctaCavernImg from '../assets/images/presentation/cta-cavern.jpg'
import planCompassIcon from '../assets/images/presentation/plan-compass.png'
import planMagnifierIcon from '../assets/images/presentation/plan-magnifier.png'
import planCrownIcon from '../assets/images/presentation/plan-crown.png'
import planFeatherIcon from '../assets/images/presentation/plan-feather.png'
import planFlameIcon from '../assets/images/presentation/plan-flame.png'
import planConstellationIcon from '../assets/images/presentation/plan-constellation.png'
import footerSocialIcons from '../assets/icons/footer-social-icons.svg'
import PresentationPlanCard from '../components/shop/PresentationPlanCard'
import { listPublicCommunityWorlds } from '../services/storyApi'
import { resolveApiResourceUrl } from '../services/httpClient'
import type { StoryCommunityWorldSummary } from '../types/story'
import { buildWorldFallbackArtwork } from '../utils/worldBackground'

const ACCENT = '#66a8ff'
const TEXT_HEADING = '#f5f4f1'
const TEXT_BODY = '#a8b0bb'
const TEXT_MUTED = '#727f8f'
const PAGE_BG = '#02050a'
const PREVIOUS_SLIDE_ARIA_LABEL = 'Предыдущий слайд'
const NEXT_SLIDE_ARIA_LABEL = 'Следующий слайд'
const FEATURED_PUBLIC_WORLDS = [
  { title: 'Нарушение условий содержания SCP', query: 'Нарушение условий содержания SCP' },
  { title: 'Операция "Скрежет когтей"', query: 'Скрежет когтей' },
  { title: 'Aincrad: Real Pain.', query: 'Aincrad' },
  { title: "Baldur's Gate III: Возвышение Абсолют", query: 'Возвышение Абсолют' },
  { title: 'Жизнь в монастыре (Англия)', query: 'Жизнь в монастыре' },
] as const

const normalizeFeaturedWorldTitle = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"'’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const primaryButtonSx: SxProps<Theme> = {
  minWidth: { xs: 148, md: 176 },
  height: { xs: 42, md: 46 },
  px: 3.5,
  borderRadius: '999px',
  background: 'linear-gradient(180deg, #75b4ff 0%, #4c8dff 100%)',
  color: '#fff',
  fontFamily: '"Manrope", sans-serif',
  fontSize: { xs: '0.82rem', md: '0.9rem' },
  fontWeight: 800,
  textTransform: 'none',
  boxShadow: '0 8px 26px rgba(53, 127, 255, 0.24)',
  transition: 'transform 180ms ease, filter 180ms ease, box-shadow 180ms ease',
  '&:hover': {
    background: 'linear-gradient(180deg, #86beff 0%, #5595ff 100%)',
    transform: 'translateY(-2px)',
    filter: 'brightness(1.05)',
    boxShadow: '0 12px 32px rgba(53, 127, 255, 0.3)',
  },
}

const sectionTitleSx: SxProps<Theme> = {
  color: TEXT_HEADING,
  fontFamily: '"Spectral", "Times New Roman", serif',
  fontSize: { xs: '1.75rem', sm: '2.15rem', md: '2.55rem' },
  fontWeight: 700,
  lineHeight: 1.12,
  letterSpacing: '0.02em',
  textAlign: 'center',
  textTransform: 'uppercase',
  textShadow: '0 4px 24px rgba(168, 211, 255, 0.16)',
}

type RevealOnViewProps = {
  children: ReactNode
  delay?: number
  y?: number
  threshold?: number
  sx?: SxProps<Theme>
}

function RevealOnView({ children, delay = 0, y = 24, threshold = 0.16, sx }: RevealOnViewProps) {
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const node = nodeRef.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      const timerId = globalThis.setTimeout(() => setIsVisible(true), 0)
      return () => globalThis.clearTimeout(timerId)
    }
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
          transition: `opacity 760ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform 760ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  )
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function usePresentationParallax(
  heroRef: RefObject<HTMLElement | null>,
  aboutRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frameId = 0
    let pointerX = 0
    let pointerY = 0

    const setPixels = (node: HTMLElement, name: string, value: number) => {
      node.style.setProperty(name, `${value.toFixed(2)}px`)
    }

    const update = () => {
      frameId = 0
      const viewportHeight = window.innerHeight || 1
      const hero = heroRef.current
      const about = aboutRef.current

      if (hero) {
        const rect = hero.getBoundingClientRect()
        const scrollDepth = reducedMotion ? 0 : clamp(-rect.top, 0, rect.height + viewportHeight)
        setPixels(hero, '--hero-bg-x', reducedMotion ? 0 : pointerX * -10)
        setPixels(hero, '--hero-bg-y', scrollDepth * 0.1 + (reducedMotion ? 0 : pointerY * -5))
        setPixels(hero, '--hero-copy-y', scrollDepth * 0.075)
        setPixels(hero, '--hero-person-x', reducedMotion ? 0 : pointerX * 22)
        setPixels(hero, '--hero-person-y', scrollDepth * 0.32 + (reducedMotion ? 0 : pointerY * 12))
        setPixels(hero, '--hero-cliff-x', reducedMotion ? 0 : pointerX * 22)
        setPixels(hero, '--hero-cliff-y', scrollDepth * 0.32 + (reducedMotion ? 0 : pointerY * 12))
      }

      if (about) {
        const rect = about.getBoundingClientRect()
        const centerDelta = reducedMotion
          ? 0
          : clamp(viewportHeight / 2 - (rect.top + rect.height / 2), -viewportHeight, viewportHeight)
        setPixels(about, '--about-bg-x', reducedMotion ? 0 : pointerX * -8)
        setPixels(about, '--about-bg-y', centerDelta * 0.12 + (reducedMotion ? 0 : pointerY * -6))
        setPixels(about, '--about-glow-x', reducedMotion ? 0 : pointerX * 18)
        setPixels(about, '--about-glow-y', centerDelta * 0.2 + (reducedMotion ? 0 : pointerY * 10))
        setPixels(about, '--about-copy-y', centerDelta * 0.035)
      }
    }

    const requestUpdate = () => {
      if (!frameId) frameId = window.requestAnimationFrame(update)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (reducedMotion || event.pointerType === 'touch') return
      pointerX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2
      pointerY = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2
      requestUpdate()
    }

    const handlePointerLeave = () => {
      pointerX = 0
      pointerY = 0
      requestUpdate()
    }

    update()
    window.addEventListener('scroll', requestUpdate, { passive: true })
    window.addEventListener('resize', requestUpdate)
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', handlePointerLeave)

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      window.removeEventListener('scroll', requestUpdate)
      window.removeEventListener('resize', requestUpdate)
      window.removeEventListener('pointermove', handlePointerMove)
      document.documentElement.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [aboutRef, heroRef])
}

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
    title: 'Шаблоны карточек',
    description:
      'Устали каждый раз заново прописывать персонажей и инструкции? Оставьте это в прошлом. Создавайте свои карточки персонажей и инструкций и используйте их в любой игре в два клика.',
    preview: slideTemplatesPreview,
  },
  {
    id: 'avatars',
    number: '02',
    title: 'Аватарки персонажей',
    description:
      'Читать историю интереснее, когда у героев есть лица. Диалоги устроены так, чтобы вы сразу видели аватар и имя собеседника.',
    preview: advantageAvatarsPreview,
  },
  {
    id: 'storytellers',
    number: '03',
    title: 'Рассказчики',
    description:
      'Мы подбираем и тестируем лучшие модели на роль мастера игры — для живых диалогов, сильных сцен и долгих приключений.',
    preview: advantageStorytellersPreview,
  },
  {
    id: 'images',
    number: '04',
    title: 'Генерация картинок',
    description:
      'Визуализируйте сцены и переключайтесь между разными художниками: от экономичных до самых выразительных моделей.',
    preview: advantageImagesPreview,
  },
  {
    id: 'community',
    number: '05',
    title: 'Сообщество',
    description:
      'Делитесь персонажами, мирами и инструкциями, добавляйте карточки других игроков и собирайте свою библиотеку идей.',
    preview: advantageCommunityPreview,
  },
  {
    id: 'memory',
    number: '06',
    title: 'Оптимизация памяти',
    description:
      'Механизм оптимизации памяти помогает сохранять важные события истории: тратьте меньше, помните больше.',
    preview: advantageMemoryPreview,
  },
]

const gameSteps = [
  { number: '01', title: 'Создай героя' },
  { number: '02', title: 'Сделай ход' },
  { number: '03', title: 'Сюжет движется' },
]

type TariffPlan = {
  id: string
  title: string
  price: string
  coins: string
  details: string[]
  icon: string
  accent: string
}

const tariffPlans: TariffPlan[] = [
  {
    id: 'pathfinder',
    title: 'Путник',
    price: '399 ₽',
    coins: '400',
    icon: planCompassIcon,
    accent: '#6daeff',
    details: [
      'Для старта, тестовых миров и коротких кампаний.',
      'Работает с лимитом контекста до 64k.',
      'Один баланс на текст, изображения и эффекты.',
    ],
  },
  {
    id: 'seeker',
    title: 'Искатель',
    price: '1 190 ₽',
    coins: '1 290',
    icon: planMagnifierIcon,
    accent: '#54e4df',
    details: [
      'Оптимален для регулярной игры и длинных сцен.',
      'Лучший баланс между ценой и запасом валюты.',
      'Один баланс на текст, изображения и эффекты.',
    ],
  },
  {
    id: 'archon',
    title: 'Архонт',
    price: '2 990 ₽',
    coins: '3 350',
    icon: planCrownIcon,
    accent: '#f4b83f',
    details: [
      'Для больших кампаний и тяжёлых сцен с запасом.',
      'Удобен при частом использовании дорогих моделей.',
      'Один баланс на текст, изображения и эффекты.',
    ],
  },
  {
    id: 'chronicler',
    title: 'Летописец',
    price: '5 990 ₽',
    coins: '7 000',
    icon: planFeatherIcon,
    accent: '#bd78ff',
    details: [
      'Максимальный запас для долгих хроник и сложных миров.',
      'Идеален для дорогих моделей и активных кампаний.',
      'Один баланс на текст, изображения и эффекты.',
    ],
  },
]

type SubscriptionPlan = {
  id: string
  title: string
  price: string
  details: string[]
  icon?: string
  accent: string
}

const subscriptionPlans: SubscriptionPlan[] = [
  {
    id: 'spark',
    title: 'Искра',
    price: '299 ₽',
    accent: '#47e4ec',
    details: [
      '2 модели: DeepSeek V4 Flash и Gemini 2.5 Flash Lite.',
      'До 40 ходов в день без списания солов.',
      'Память сцены до 8K токенов.',
    ],
  },
  {
    id: 'flame',
    title: 'Пламя',
    price: '599 ₽',
    icon: planFlameIcon,
    accent: '#ff4351',
    details: [
      '3 модели: DeepSeek V4 Flash, Gemini 2.5 Flash Lite и GLM 4.5 Air.',
      'До 60 ходов в день без списания солов.',
      'Память сцены до 20K токенов.',
    ],
  },
  {
    id: 'constellation',
    title: 'Созвездие',
    price: '1 190 ₽',
    icon: planConstellationIcon,
    accent: '#f3c63c',
    details: [
      '4 модели: добавляется Gemini 3 Flash Preview.',
      'До 90 ходов в день без списания солов.',
      'Память сцены до 32K токенов.',
    ],
  },
]

type LandingWorldCardData = {
  id: string
  numericId: number
  title: string
  description: string
  author: string
  coverUrl: string | null
  coverPosition: string
  launches: number
  rating: number
}

function LandingWorldCard({ world, onClick }: { world: LandingWorldCardData; onClick: () => void }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        width: { xs: 238, sm: 270, md: 292 },
        height: { xs: 338, md: 388 },
        flex: '0 0 auto',
        p: 0,
        overflow: 'hidden',
        borderRadius: '10px',
        border: '1px solid rgba(141, 202, 255, 0.18)',
        background: '#07111a',
        color: TEXT_HEADING,
        textAlign: 'left',
        cursor: 'pointer',
        boxShadow: '0 28px 70px rgba(0,0,0,0.62)',
        transition: 'transform 220ms ease, border-color 220ms ease, filter 220ms ease',
        '&:hover': {
          transform: 'translateY(-8px)',
          borderColor: 'rgba(117, 188, 255, 0.55)',
          filter: 'brightness(1.08)',
        },
        '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: 4 },
      }}
    >
      <Box sx={{ position: 'relative', height: { xs: 176, md: 205 }, overflow: 'hidden' }}>
        {world.coverUrl ? (
          <Box
            component="img"
            src={world.coverUrl}
            alt=""
            loading="lazy"
            decoding="async"
            sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: world.coverPosition }}
          />
        ) : (
          <Box sx={{ position: 'absolute', inset: 0, ...buildWorldFallbackArtwork(world.numericId) }} />
        )}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, transparent 30%, rgba(4,9,14,0.25) 58%, #07111a 100%)',
          }}
        />
      </Box>
      <Stack sx={{ px: 2, pb: 2, mt: -1.2, position: 'relative', height: { xs: 162, md: 183 } }}>
        <Typography
          component="h3"
          sx={{ color: TEXT_HEADING, fontFamily: '"Spectral", serif', fontWeight: 700, fontSize: '1.18rem' }}
        >
          {world.title}
        </Typography>
        <Typography
          sx={{
            mt: 0.7,
            color: TEXT_BODY,
            fontSize: '0.76rem',
            lineHeight: 1.52,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {world.description}
        </Typography>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 'auto' }}>
          <Typography sx={{ color: TEXT_MUTED, fontSize: '0.7rem' }}>{world.author}</Typography>
          <Typography sx={{ color: '#e6edf5', fontSize: '0.7rem', fontWeight: 800 }}>
            {world.launches} &nbsp;★ {world.rating.toFixed(1)}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  )
}

const footerInfoLinks = [
  { label: 'Политика конфиденциальности', path: '/privacy-policy' },
  { label: 'Пользовательское соглашение', path: '/terms-of-service' },
  { label: 'Условия подписки', path: '/subscription-terms' },
]

function PresentationFooter({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <Box component="footer" sx={{ color: '#aaa6a2', backgroundColor: '#020407' }}>
      <Box
        sx={{
          minHeight: { xs: 210, md: 180 },
          maxWidth: 1500,
          mx: 'auto',
          px: { xs: 3, md: 7 },
          py: { xs: 4, md: 5 },
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '160px 1fr 130px' },
          alignItems: 'center',
          justifyItems: { xs: 'center', md: 'stretch' },
          gap: { xs: 3, md: 4 },
        }}
      >
        <Box
          component="button"
          type="button"
          aria-label="На главную"
          onClick={() => onNavigate('/')}
          sx={{ p: 0, border: 0, background: 'none', cursor: 'pointer', justifySelf: { md: 'start' } }}
        >
          <Box
            component="img"
            src={brandLogo}
            alt="MoRius"
            sx={{ display: 'block', width: 66, height: 'auto', filter: 'brightness(0) invert(1)' }}
          />
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="center" spacing={{ xs: 1.5, sm: 5 }}>
          {footerInfoLinks.slice(0, 2).map((link) => (
            <Box
              key={link.path}
              component="button"
              type="button"
              onClick={() => onNavigate(link.path)}
              sx={{
                p: 0,
                border: 0,
                background: 'none',
                color: '#aaa6a2',
                fontFamily: '"Manrope", sans-serif',
                fontSize: '0.84rem',
                cursor: 'pointer',
                '&:hover': { color: '#f0eeeb' },
              }}
            >
              {link.label}
            </Box>
          ))}
        </Stack>

        <Box sx={{ position: 'relative', width: 100, height: 40, justifySelf: { md: 'end' } }}>
          <Box component="img" src={footerSocialIcons} alt="" sx={{ width: 100, height: 40, display: 'block' }} />
          <Box component="a" href="https://t.me/+t2ueY4x_KvE4ZWEy" target="_blank" rel="noopener noreferrer" aria-label="Telegram" sx={{ position: 'absolute', inset: '0 54px 0 0' }} />
          <Box component="a" href="https://vk.com/moriusai" target="_blank" rel="noopener noreferrer" aria-label="ВКонтакте" sx={{ position: 'absolute', inset: '0 0 0 58px' }} />
        </Box>
      </Box>

      <Box sx={{ borderTop: '1px solid rgba(255,255,255,0.09)', px: 2, py: 2.2 }}>
        <Typography sx={{ color: '#7d7a77', fontSize: { xs: '0.6rem', md: '0.68rem' }, textAlign: 'center' }}>
          Бондарук Александр Георгиевич | ИНН: 772702320496 | ОГРНИП: 325774600487692 | Почта: alexunderstood8@gmail.com &nbsp;&nbsp;&nbsp; © 2026
        </Typography>
      </Box>
    </Box>
  )
}

type PublicLandingPageProps = {
  isAuthenticated: boolean
  pendingReferralCode?: string | null
  onNavigate: (path: string) => void
  onGoHome: () => void
}

export default function PublicLandingPage({
  isAuthenticated,
  pendingReferralCode,
  onNavigate,
  onGoHome,
}: PublicLandingPageProps) {
  const heroRef = useRef<HTMLElement | null>(null)
  const aboutRef = useRef<HTMLElement | null>(null)
  const openedReferralCodeRef = useRef<string | null>(null)
  const [currentSlide, setCurrentSlide] = useState(0)
  const [publicWorlds, setPublicWorlds] = useState<StoryCommunityWorldSummary[]>([])
  const [worldsLoading, setWorldsLoading] = useState(true)
  const [worldsLoadFailed, setWorldsLoadFailed] = useState(false)

  usePresentationParallax(heroRef, aboutRef)

  useEffect(() => {
    let active = true
    void Promise.all(
      FEATURED_PUBLIC_WORLDS.map((featuredWorld) =>
        listPublicCommunityWorlds({ limit: 20, sort: 'updated_desc', query: featuredWorld.query }),
      ),
    )
      .then((worldGroups) => {
        if (!active) return
        const selectedWorlds = FEATURED_PUBLIC_WORLDS.flatMap((featuredWorld, index) => {
          const expectedTitle = normalizeFeaturedWorldTitle(featuredWorld.title)
          const match = worldGroups[index]?.find(
            (world) => normalizeFeaturedWorldTitle(world.title) === expectedTitle,
          )
          return match ? [match] : []
        }).filter((world, index, worlds) => worlds.findIndex((candidate) => candidate.id === world.id) === index)
        setPublicWorlds(selectedWorlds)
        setWorldsLoadFailed(false)
      })
      .catch(() => {
        if (!active) return
        setPublicWorlds([])
        setWorldsLoadFailed(true)
      })
      .finally(() => {
        if (active) setWorldsLoading(false)
      })
    return () => {
      active = false
    }
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

  const worldDeck = useMemo<LandingWorldCardData[]>(() => {
    return publicWorlds.slice(0, 5).map((world) => ({
      id: String(world.id),
      numericId: world.id,
      title: world.title,
      description: world.description || 'Автор пока не добавил описание мира.',
      author: world.author_name,
      coverUrl: resolveApiResourceUrl(world.cover_image_url) || null,
      coverPosition: `${world.cover_position_x ?? 50}% ${world.cover_position_y ?? 50}%`,
      launches: world.community_launches,
      rating: world.community_rating_avg,
    }))
  }, [publicWorlds])

  const activeAdvantage = advantageSlides[currentSlide]

  return (
    <Box
      className="morius-app-shell"
      sx={{
        backgroundColor: PAGE_BG,
        color: TEXT_BODY,
        overflowX: 'hidden',
        '@keyframes morius-presentation-float': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -7px, 0)' },
        },
        '@media (prefers-reduced-motion: reduce)': {
          '& *, & *::before, & *::after': {
            scrollBehavior: 'auto !important',
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
          },
        },
      }}
    >
      <Box sx={{ position: 'relative', overflow: 'hidden', backgroundColor: '#030914' }}>
        <Box
          ref={heroRef}
          component="section"
          sx={{
            position: 'relative',
            zIndex: 2,
            minHeight: { xs: '820px', sm: 680 },
            height: { sm: 'clamp(680px, 100svh, 1000px)' },
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            px: 2,
            pt: { xs: '11vh', sm: '9vh', md: '8vh' },
            isolation: 'isolate',
          }}
        >
          <Box
            component="img"
            src={heroSkyImg}
            alt=""
            fetchPriority="high"
            decoding="async"
            sx={{
              position: 'absolute',
              inset: '-7%',
              zIndex: -3,
              width: '114%',
              height: '114%',
              objectFit: 'cover',
              objectPosition: { xs: '50% 50%', md: '50% 56%' },
              transform: 'translate3d(var(--hero-bg-x, 0px), var(--hero-bg-y, 0px), 0) scale(1.08)',
              willChange: 'transform',
            }}
          />
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: -2,
              background:
                'radial-gradient(circle at 50% 56%, rgba(139,202,255,0.12), transparent 25%), linear-gradient(180deg, rgba(1,5,12,0.04) 0%, rgba(1,5,12,0.1) 58%, rgba(2,7,13,0.78) 100%)',
            }}
          />
          <Box
            component="img"
            src={heroWandererImg}
            alt=""
            decoding="async"
            sx={{
              position: 'absolute',
              zIndex: 5,
              left: '50%',
              bottom: { xs: '23.5%', sm: '17.5%', md: '16%' },
              width: { xs: 310, sm: 420, md: 'clamp(470px, 28vw, 540px)' },
              height: 'auto',
              transform:
                'translate3d(calc(-50% + var(--hero-person-x, 0px)), var(--hero-person-y, 0px), 0)',
              filter: 'drop-shadow(0 24px 34px rgba(0,0,0,0.72))',
              willChange: 'transform',
              '@media (min-width: 1500px) and (max-height: 850px)': {
                width: 385,
                bottom: '16%',
              },
            }}
          />
          <Box
            component="img"
            src={heroCliffImg}
            alt=""
            decoding="async"
            sx={{
              position: 'absolute',
              zIndex: 4,
              left: '50%',
              top: { xs: '22%', sm: '28%', md: '30%' },
              width: { xs: '190%', sm: '136%', md: '100%' },
              maxWidth: 'none',
              height: '102%',
              objectFit: 'fill',
              transform:
                'translate3d(calc(-50% + var(--hero-cliff-x, 0px)), var(--hero-cliff-y, 0px), 0)',
              filter: 'drop-shadow(0 -20px 40px rgba(0,0,0,0.36))',
              willChange: 'transform',
              pointerEvents: 'none',
              '@media (min-width: 1500px) and (max-height: 850px)': {
                top: '30%',
              },
            }}
          />

          <Stack
            alignItems="center"
            textAlign="center"
            sx={{
              position: 'relative',
              zIndex: 6,
              width: '100%',
              maxWidth: 850,
              transform: 'translate3d(0, var(--hero-copy-y, 0px), 0)',
              willChange: 'transform',
            }}
          >
            <Box
              component="img"
              src={brandLogo}
              alt="MoRius"
              sx={{
                width: { xs: 82, sm: 98, md: 112 },
                height: 'auto',
                filter: 'brightness(0) invert(1) drop-shadow(0 8px 22px rgba(255,255,255,0.2))',
                animation: 'morius-presentation-float 5.5s ease-in-out infinite',
                '@media (min-width: 1500px) and (max-height: 850px)': {
                  width: 96,
                },
              }}
            />
            <Typography
              component="h1"
              sx={{
                mt: { xs: 1.3, md: 1.8 },
                color: TEXT_HEADING,
                fontFamily: '"Spectral", "Times New Roman", serif',
                fontSize: { xs: '2.15rem', sm: '3rem', md: '3.8rem' },
                fontWeight: 700,
                lineHeight: 1.04,
                textShadow: '0 5px 28px rgba(0,0,0,0.72), 0 0 24px rgba(118,188,255,0.12)',
                '@media (min-width: 1500px) and (max-height: 850px)': {
                  mt: 0.8,
                  fontSize: '2.35rem',
                },
              }}
            >
              История начинается сейчас
            </Typography>
            <Typography
              sx={{
                mt: 1.1,
                maxWidth: 650,
                color: '#c3ccd7',
                fontSize: { xs: '0.82rem', sm: '0.95rem', md: '1.02rem' },
                lineHeight: 1.65,
                textShadow: '0 2px 12px rgba(0,0,0,0.9)',
                '@media (min-width: 1500px) and (max-height: 850px)': {
                  mt: 0.6,
                  maxWidth: 560,
                  fontSize: '0.82rem',
                  lineHeight: 1.5,
                },
              }}
            >
              Текстовое приключение, где ИИ ведёт игру, а ты решаешь, кем стать и как закончится история
            </Typography>
            <Button
              variant="contained"
              onClick={() => openAuthPage('register')}
              sx={{
                ...primaryButtonSx,
                mt: 2.4,
                '@media (min-width: 1500px) and (max-height: 850px)': {
                  minWidth: 132,
                  height: 36,
                  mt: 1.4,
                  px: 2.5,
                  fontSize: '0.74rem',
                },
              }}
            >
              Начать играть
            </Button>
          </Stack>
        </Box>

        <Box
          ref={aboutRef}
          component="section"
          sx={{
            position: 'relative',
            zIndex: 1,
            minHeight: { xs: 760, md: '100svh' },
            height: { md: '100svh' },
            display: 'grid',
            placeItems: 'center',
            px: 2,
            pt: { xs: 18, md: 12 },
            pb: { xs: 10, md: 12 },
            isolation: 'isolate',
          }}
        >
          <Box
            component="img"
            src={aboutCavernImg}
            alt=""
            loading="eager"
            decoding="async"
            sx={{
              position: 'absolute',
              inset: '-10%',
              zIndex: -3,
              width: '120%',
              height: '120%',
              objectFit: 'cover',
              objectPosition: 'center',
              transform: 'translate3d(var(--about-bg-x, 0px), var(--about-bg-y, 0px), 0) scale(1.06)',
              willChange: 'transform',
            }}
          />
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: -2,
              background:
                'linear-gradient(180deg, rgba(1,5,10,0.18) 0%, rgba(2,9,17,0.14) 34%, rgba(2,8,15,0.32) 74%, #03101a 100%)',
            }}
          />
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              zIndex: -1,
              left: '50%',
              top: '46%',
              width: { xs: 380, md: 720 },
              height: { xs: 320, md: 480 },
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(126,201,255,0.16), rgba(75,144,202,0.05) 44%, transparent 70%)',
              transform:
                'translate3d(calc(-50% + var(--about-glow-x, 0px)), calc(-50% + var(--about-glow-y, 0px)), 0)',
              filter: 'blur(6px)',
              willChange: 'transform',
            }}
          />

          <RevealOnView>
            <Stack
              alignItems="center"
              textAlign="center"
              sx={{
                maxWidth: 770,
                transform: 'translate3d(0, calc(10vh + var(--about-copy-y, 0px)), 0)',
                willChange: 'transform',
              }}
            >
              <Typography
                component="h2"
                sx={{
                  ...sectionTitleSx,
                  fontSize: { xs: '2.15rem', sm: '2.75rem', md: '3.25rem' },
                  textTransform: 'none',
                }}
              >
                О проекте
              </Typography>
              <Typography
                sx={{
                  mt: { xs: 2, md: 2.4 },
                  maxWidth: 820,
                  color: '#c9d2dc',
                  fontSize: { xs: '0.94rem', sm: '1.04rem', md: '1.18rem' },
                  lineHeight: 1.85,
                }}
              >
                Morius AI — это текстовая MMORPG с искусственным интеллектом, где сюжет, персонажи и развитие мира
                формируются в живом взаимодействии с игроком
              </Typography>
              <Button variant="contained" onClick={() => openAuthPage('register')} sx={{ ...primaryButtonSx, mt: 3 }}>
                Начать играть
              </Button>
            </Stack>
          </RevealOnView>
        </Box>
      </Box>

      <Box
        id="how-it-works"
        component="section"
        sx={{
          position: 'relative',
          minHeight: { xs: 830, md: '100svh' },
          height: { md: '100svh' },
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
          px: 2,
          py: { xs: 10, md: 13 },
          backgroundColor: '#03101a',
        }}
      >
        <Box
          component="img"
          src={underwaterCavernImg}
          alt=""
          loading="lazy"
          decoding="async"
          sx={{
            position: 'absolute',
            inset: '-2% 0 0',
            width: '100%',
            height: '102%',
            objectFit: 'cover',
            objectPosition: { xs: '52% 26%', md: '50% 24%' },
            opacity: 0.84,
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, #03101a 0%, rgba(3,16,26,0.18) 12%, rgba(2,9,16,0.18) 45%, rgba(2,6,11,0.86) 100%)',
          }}
        />
        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <RevealOnView>
            <Stack alignItems="center" textAlign="center">
              <Typography component="h2" sx={sectionTitleSx}>
                Как устроена игра
              </Typography>
              <Typography sx={{ mt: 1.3, color: '#aebdca', fontSize: { xs: '0.82rem', md: '0.96rem' } }}>
                Ты выбираешь действия. ИИ ведёт мир: описывает сцены, персонажей и последствия
              </Typography>
            </Stack>
          </RevealOnView>

          <Box
            sx={{
              position: 'relative',
              mt: { xs: 6, md: 7 },
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
              gap: { xs: 3.2, md: 3 },
            }}
          >
            <Box
              aria-hidden
              sx={{
                display: { xs: 'none', md: 'block' },
                position: 'absolute',
                zIndex: 0,
                top: 23,
                left: '16.67%',
                right: '16.67%',
                height: '1px',
                backgroundColor: 'rgba(102,168,255,0.72)',
                boxShadow: '0 0 12px rgba(102,168,255,0.22)',
              }}
            />
            {gameSteps.map((step, index) => (
              <RevealOnView key={step.number} delay={index * 100}>
                <Stack alignItems="center" textAlign="center">
                  <Box
                    sx={{
                      position: 'relative',
                      zIndex: 1,
                      width: 48,
                      height: 48,
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: '50%',
                      border: '1.5px solid rgba(103,171,255,0.9)',
                      background: '#06121d',
                      color: '#8fc4ff',
                      fontFamily: '"Spectral", serif',
                      fontSize: '1.08rem',
                      fontWeight: 700,
                      boxShadow: '0 0 26px rgba(70,137,255,0.16)',
                    }}
                  >
                    {step.number}
                  </Box>
                  <Typography
                    component="h3"
                    sx={{
                      mt: 1.8,
                      color: TEXT_HEADING,
                      fontFamily: '"Spectral", serif',
                      fontSize: { xs: '1.08rem', md: '1.32rem' },
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {step.title}
                  </Typography>
                </Stack>
              </RevealOnView>
            ))}
          </Box>

          <RevealOnView delay={220}>
            <Typography
              sx={{
                maxWidth: 850,
                mx: 'auto',
                mt: { xs: 5, md: 4.5 },
                color: '#9aa8b5',
                fontSize: { xs: '0.78rem', md: '0.88rem' },
                lineHeight: 1.75,
                textAlign: 'center',
              }}
            >
              Выбери готовый образ или собери персонажа под себя: задай внешность, характер, роль и мотивацию и
              стартовую ситуацию. Это может быть благородный рыцарь, хитрый вор, изгнанный маг, случайный путник или
              герой, которого ты полностью придумал сам. С этого начинается твоя личная история в мире MoRius.
            </Typography>
          </RevealOnView>
        </Container>
      </Box>

      <Box id="advantages" component="section" sx={{ position: 'relative', overflow: 'hidden', py: { xs: 10, md: 14 }, background: '#02070d' }}>
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at 50% 0%, rgba(36,91,137,0.18), transparent 52%), linear-gradient(180deg, #02070d 0%, #02050a 100%)',
          }}
        />
        <Container maxWidth="lg" sx={{ position: 'relative' }}>
          <RevealOnView>
            <Typography component="h2" sx={{ ...sectionTitleSx, mb: { xs: 6, md: 8 } }}>
              Преимущества и особенности
            </Typography>
          </RevealOnView>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 0.9fr) minmax(420px, 1.1fr)' },
              alignItems: 'center',
              gap: { xs: 5, md: 8 },
              minHeight: { md: 480 },
            }}
          >
            <RevealOnView key={`advantage-copy-${activeAdvantage.id}`}>
              <Box>
                <Typography
                  aria-hidden
                  sx={{
                    color: 'transparent',
                    WebkitTextStroke: `2px ${ACCENT}`,
                    fontFamily: '"Manrope", sans-serif',
                    fontSize: { xs: '8rem', md: '12rem' },
                    fontWeight: 700,
                    lineHeight: 0.78,
                    opacity: 0.82,
                    WebkitMaskImage: 'linear-gradient(180deg, #000 0%, #000 48%, transparent 92%)',
                    maskImage: 'linear-gradient(180deg, #000 0%, #000 48%, transparent 92%)',
                  }}
                >
                  {activeAdvantage.number}
                </Typography>
                <Typography
                  component="h3"
                  sx={{ mt: -0.5, color: '#d8e0e8', fontFamily: '"Spectral", serif', fontSize: { xs: '1.35rem', md: '1.7rem' }, textTransform: 'uppercase' }}
                >
                  {activeAdvantage.title}
                </Typography>
                <Typography sx={{ mt: 1.5, maxWidth: 520, color: TEXT_BODY, fontSize: { xs: '0.84rem', md: '0.94rem' }, lineHeight: 1.72 }}>
                  {activeAdvantage.description}
                </Typography>
              </Box>
            </RevealOnView>

            <RevealOnView key={`advantage-image-${activeAdvantage.id}`} delay={80}>
              <Box
                sx={{
                  position: 'relative',
                  display: 'grid',
                  placeItems: 'center',
                  minHeight: { xs: 330, md: 460 },
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    inset: '8%',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(58,133,216,0.19), transparent 68%)',
                    filter: 'blur(18px)',
                  },
                }}
              >
                <Box
                  component="img"
                  src={activeAdvantage.preview}
                  alt={activeAdvantage.title}
                  loading="lazy"
                  decoding="async"
                  sx={{
                    position: 'relative',
                    width: { xs: '94%', md: '100%' },
                    maxWidth: 570,
                    maxHeight: 470,
                    objectFit: 'contain',
                    transform: 'rotate(4deg)',
                    filter: 'drop-shadow(0 28px 46px rgba(0,0,0,0.7))',
                  }}
                />
              </Box>
            </RevealOnView>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={2.2} sx={{ mt: { xs: 3, md: 1 } }}>
            <Stack direction="row" spacing={1}>
              <Box
                component="button"
                type="button"
                onClick={() => setCurrentSlide((index) => Math.max(0, index - 1))}
                disabled={currentSlide === 0}
                aria-label={PREVIOUS_SLIDE_ARIA_LABEL}
                sx={{
                  width: 48,
                  height: 38,
                  p: 0,
                  border: 0,
                  background: 'transparent',
                  color: currentSlide === 0 ? 'rgba(102,168,255,0.28)' : ACCENT,
                  fontSize: '2.1rem',
                  lineHeight: 1,
                  cursor: currentSlide === 0 ? 'default' : 'pointer',
                  textShadow: currentSlide === 0 ? 'none' : '0 0 16px rgba(102,168,255,0.48)',
                  transition: 'color 180ms ease, transform 180ms ease',
                  '&:not(:disabled):hover': { color: '#a5d0ff', transform: 'translateX(-3px)' },
                  '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: 3 },
                }}
              >
                ←
              </Box>
              <Box
                component="button"
                type="button"
                onClick={() => setCurrentSlide((index) => Math.min(advantageSlides.length - 1, index + 1))}
                disabled={currentSlide === advantageSlides.length - 1}
                aria-label={NEXT_SLIDE_ARIA_LABEL}
                sx={{
                  width: 48,
                  height: 38,
                  p: 0,
                  border: 0,
                  background: 'transparent',
                  color: currentSlide === advantageSlides.length - 1 ? 'rgba(102,168,255,0.28)' : ACCENT,
                  fontSize: '2.1rem',
                  lineHeight: 1,
                  cursor: currentSlide === advantageSlides.length - 1 ? 'default' : 'pointer',
                  textShadow: currentSlide === advantageSlides.length - 1 ? 'none' : '0 0 16px rgba(102,168,255,0.48)',
                  transition: 'color 180ms ease, transform 180ms ease',
                  '&:not(:disabled):hover': { color: '#a5d0ff', transform: 'translateX(3px)' },
                  '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: 3 },
                }}
              >
                →
              </Box>
            </Stack>
            <Stack direction="row" spacing={0.7}>
              {advantageSlides.map((slide, index) => (
                <Box
                  key={slide.id}
                  component="button"
                  type="button"
                  aria-label={`Слайд ${index + 1}`}
                  onClick={() => setCurrentSlide(index)}
                  sx={{
                    width: index === currentSlide ? 52 : 38,
                    height: 3,
                    p: 0,
                    border: 0,
                    borderRadius: 2,
                    cursor: 'pointer',
                    backgroundColor: index === currentSlide ? ACCENT : 'rgba(196,207,218,0.34)',
                    transition: 'width 180ms ease, background-color 180ms ease',
                  }}
                />
              ))}
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Box id="public-worlds" component="section" sx={{ position: 'relative', overflow: 'hidden', py: { xs: 10, md: 14 }, backgroundColor: '#02050a' }}>
        <Box
          component="img"
          src={dragonDepthsImg}
          alt=""
          loading="lazy"
          sx={{
            position: 'absolute',
            left: 0,
            bottom: '-6%',
            width: '100%',
            height: '82%',
            objectFit: 'cover',
            objectPosition: 'left center',
            opacity: 0.62,
          }}
        />
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #02050a 0%, rgba(2,5,10,0.42) 34%, #02050a 100%)' }} />
        <Container maxWidth="lg" sx={{ position: 'relative' }}>
          <RevealOnView>
            <Typography component="h2" sx={{ ...sectionTitleSx, textTransform: 'none' }}>
              Публичные готовые миры
            </Typography>
            <Typography sx={{ mt: 1.4, color: TEXT_BODY, fontSize: { xs: '0.82rem', md: '0.94rem' }, textAlign: 'center' }}>
              Создавай миры и делись ими, или играй в готовые созданные другими игроками!
            </Typography>
          </RevealOnView>

          <Box
            sx={{
              mt: { xs: 5, md: 7 },
              height: { xs: 374, md: 500 },
              mx: { xs: -2, md: 0 },
              px: { xs: 2, md: 0 },
              overflowX: { xs: 'auto', md: 'visible' },
              overflowY: 'visible',
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            <Box
              sx={{
                position: 'relative',
                display: { xs: 'flex', md: 'block' },
                gap: 2,
                width: { xs: 'max-content', md: '100%' },
                height: '100%',
                perspective: { md: '1300px' },
              }}
            >
              {worldsLoading || worldsLoadFailed || worldDeck.length === 0 ? (
                <Typography
                  role="status"
                  sx={{
                    position: { md: 'absolute' },
                    top: { md: '50%' },
                    left: { md: '50%' },
                    transform: { md: 'translate(-50%, -50%)' },
                    width: '100%',
                    color: TEXT_MUTED,
                    fontSize: '0.9rem',
                    textAlign: 'center',
                  }}
                >
                  {worldsLoading
                    ? 'Загружаем опубликованные миры игроков…'
                    : worldsLoadFailed
                      ? 'Не удалось загрузить опубликованные миры.'
                      : 'Игроки пока не опубликовали ни одного мира.'}
                </Typography>
              ) : (
                worldDeck.map((world, index) => {
                  const centerOffset = index - (worldDeck.length - 1) / 2
                  const distance = Math.abs(centerOffset)
                  const x = centerOffset * 220
                  const y = distance * 30 - 20
                  const z = 50 - distance * 70
                  const rotationY = centerOffset * -4
                  const rotationZ = centerOffset * 1.1
                  const scale = 1.06 - distance * 0.11
                  return (
                    <Box
                      key={world.id}
                      sx={{
                        position: { xs: 'relative', md: 'absolute' },
                        zIndex: { md: Math.max(1, 6 - Math.round(distance * 2)) },
                        top: { md: '50%' },
                        left: { md: '50%' },
                        transform: {
                          xs: 'none',
                          md: `translate(-50%, -50%) translate3d(${x}px, ${y}px, ${z}px) rotateY(${rotationY}deg) rotateZ(${rotationZ}deg) scale(${scale})`,
                        },
                        transformOrigin: 'center',
                        transition: 'transform 240ms ease',
                      }}
                    >
                      <LandingWorldCard world={world} onClick={() => openAuthPage('register')} />
                    </Box>
                  )
                })
              )}
            </Box>
          </Box>
        </Container>
      </Box>

      <Box id="packages" component="section" sx={{ position: 'relative', overflow: 'hidden', py: { xs: 10, md: 13 }, background: '#02050a' }}>
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at 14% 0%, rgba(31,94,151,0.14), transparent 38%), radial-gradient(ellipse at 85% 70%, rgba(78,40,110,0.08), transparent 38%)',
          }}
        />
        <Container maxWidth="lg" sx={{ position: 'relative' }}>
          <RevealOnView>
            <Typography component="h2" sx={{ ...sectionTitleSx, mb: { xs: 5, md: 6 } }}>
              Пакеты
            </Typography>
          </RevealOnView>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
              gap: 2,
              maxWidth: 1180,
              mx: 'auto',
            }}
          >
            {tariffPlans.map((plan, index) => (
              <RevealOnView key={plan.id} delay={index * 80} y={30}>
                <PresentationPlanCard
                  title={plan.title}
                  price={plan.price}
                  accent={plan.accent}
                  details={plan.details}
                  iconSrc={plan.icon}
                  balance={plan.coins}
                  buttonLabel="Купить"
                  onClick={() => openAuthPage('register')}
                  minHeight={500}
                />
              </RevealOnView>
            ))}
          </Box>
        </Container>
      </Box>

      <Box id="subscriptions" component="section" sx={{ position: 'relative', py: { xs: 10, md: 13 }, background: '#02050a' }}>
        <Container maxWidth="lg">
          <RevealOnView>
            <Typography component="h2" sx={{ ...sectionTitleSx, mb: { xs: 5, md: 6 } }}>
              Подписки
            </Typography>
          </RevealOnView>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 2.2,
              maxWidth: 940,
              mx: 'auto',
            }}
          >
            {subscriptionPlans.map((plan, index) => (
              <RevealOnView key={plan.id} delay={index * 90} y={30}>
                <PresentationPlanCard
                  title={plan.title}
                  price={plan.price}
                  accent={plan.accent}
                  details={plan.details}
                  iconSrc={plan.icon}
                  sparkleIcon={plan.id === 'spark'}
                  priceCaption="в месяц"
                  buttonLabel="Купить"
                  onClick={() => openAuthPage('register')}
                  minHeight={455}
                />
              </RevealOnView>
            ))}
          </Box>
        </Container>
      </Box>

      <Box
        id="start-playing"
        component="section"
        sx={{
          position: 'relative',
          minHeight: { xs: 400, md: 470 },
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
          px: 2,
          backgroundColor: '#03101a',
        }}
      >
        <Box
          component="img"
          src={ctaCavernImg}
          alt=""
          loading="eager"
          decoding="async"
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: { xs: '50% 48%', md: '50% 54%' },
            clipPath: { xs: 'polygon(0 5%, 100% 0, 100% 95%, 0 100%)', md: 'polygon(0 10%, 100% 0, 100% 90%, 0 100%)' },
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at 50% 42%, rgba(127,185,231,0.12), transparent 34%), linear-gradient(180deg, rgba(2,6,11,0.38), rgba(3,14,24,0.22), rgba(2,5,10,0.64))',
            clipPath: { xs: 'polygon(0 5%, 100% 0, 100% 95%, 0 100%)', md: 'polygon(0 10%, 100% 0, 100% 90%, 0 100%)' },
          }}
        />
        <Stack alignItems="center" textAlign="center" sx={{ position: 'relative', zIndex: 1 }}>
            <Typography
              component="h2"
              sx={{
                ...sectionTitleSx,
                fontFamily: '"Manrope", sans-serif',
                fontSize: { xs: '1.55rem', md: '2rem' },
                fontWeight: 800,
                letterSpacing: 0,
                textShadow: 'none',
              }}
            >
              Готов сделать первый ход?
            </Typography>
            <Typography sx={{ mt: 1.4, color: '#9eacba', fontSize: { xs: '0.8rem', md: '0.92rem' } }}>
              Зарегистрируйся и начни играть
            </Typography>
            <Button variant="contained" onClick={() => openAuthPage('register')} sx={{ ...primaryButtonSx, mt: 2.7 }}>
              Начать игру
            </Button>
        </Stack>
      </Box>

      <PresentationFooter onNavigate={onNavigate} />
    </Box>
  )
}
