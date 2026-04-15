import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  IconButton,
  Stack,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material'
import type { SystemStyleObject } from '@mui/system'
import { brandLogo, heroBackground, heroClouds, icons } from '../assets'
import advantageTemplatesIcon from '../assets/icons/advantages/templates.svg'
import advantageAvatarsIcon from '../assets/icons/advantages/avatars.svg'
import advantageStorytellersIcon from '../assets/icons/advantages/storytellers.svg'
import advantageImagesIcon from '../assets/icons/advantages/images.svg'
import advantageCommunityIcon from '../assets/icons/advantages/community.svg'
import advantageMemoryIcon from '../assets/icons/advantages/memory.svg'
import advantageTemplatesPreview from '../assets/images/advantages/templates-preview.png'
import advantageAvatarsPreview from '../assets/images/advantages/avatars-preview.png'
import advantageStorytellersPreview from '../assets/images/advantages/storytellers-preview.png'
import advantageImagesPreview from '../assets/images/advantages/images-preview.png'
import advantageCommunityPreview from '../assets/images/advantages/community-preview.png'
import advantageMemoryPreview from '../assets/images/advantages/memory-preview.png'
import AuthDialog, { type AuthMode } from '../components/AuthDialog'
import TextLimitIndicator from '../components/TextLimitIndicator'
import Footer from '../components/Footer'
import type { AuthResponse } from '../types/auth'

const STORY_TEXT =
  'Трактирщик с грохотом ставит перед вами деревянную кружку, пена стекает по краям. «Пять медных, странник», - бурчит он. В этот момент музыка стихает, и вы чувствуете тяжелую руку на своем плече. Это один из местных наемников, и он выглядит недружелюбно.'
const LANDING_PROMPT_MAX_LENGTH = 8000

const featureCards = [
  {
    id: 'choice',
    title: 'Каждое решение меняет мир',
    description:
      'Союзники запоминают, враги мстят, слухи расходятся. Ты строишь репутацию поступками.',
    icon: icons.like,
  },
  {
    id: 'gm',
    title: 'Ты - герой. ИИ - мастер игры',
    description:
      'Ты задаёшь намерение, мы создаём сцену и ведём сюжет дальше - как в настолке, только быстрее.',
    icon: icons.settings,
  },
  {
    id: 'pay',
    title: 'Плати только за действие',
    description: 'Никаких подписок "на всякий случай". Тратишь только когда играешь.',
    icon: icons.send,
  },
]

const tariffPlans: Array<{
  id: string
  title: string
  price: string
  coins: string
  isHighlighted?: boolean
  badge?: string
}> = [
  {
    id: 'starter',
    title: 'Старт',
    price: '0 ₽',
    coins: '20 солов',
    isHighlighted: false,
  },
  {
    id: 'standard',
    title: 'Путник',
    price: '490 ₽',
    coins: '350 солов',
  },
  {
    id: 'pro',
    title: 'Искатель',
    price: '1190 ₽',
    coins: '1000 солов',
    isHighlighted: true,
    badge: 'Популярный',
  },
  {
    id: 'mega',
    title: 'Архонт',
    price: '3990 ₽',
    coins: '3400 солов',
  },
]

type AdvantageCard = {
  id: string
  title: string
  description: string
  icon: string
  preview: string
  rowMinHeight: number
  previewSx: SystemStyleObject<Theme>
}

const advantageCards: AdvantageCard[] = [
  {
    id: 'templates',
    title: 'Шаблоны карточек',
    description:
      'Устали каждый раз заново прописывать персонажей и инструкции? Оставьте это в прошлом. Создавайте свои карточки персонажей и инструкций и используйте их в любой игре в два клика.',
    icon: advantageTemplatesIcon,
    preview: advantageStorytellersPreview,
    rowMinHeight: 228,
    previewSx: {
      width: { sm: 286, md: 322, lg: 350 },
      top: { sm: -46, md: -58, lg: -68 },
      right: { sm: -16, md: -24, lg: -34 },
      transform: 'rotate(9deg)',
    },
  },
  {
    id: 'avatars',
    title: 'Аватарки персонажей',
    description:
      'Читать историю интересно, но для более глубокого погружения важно видеть лица героев. Мы сделали отображение диалога так, чтобы вы, почти как в мессенджере, сразу видели аватар и имя собеседника.',
    icon: advantageAvatarsIcon,
    preview: advantageAvatarsPreview,
    rowMinHeight: 226,
    previewSx: {
      width: { sm: 320, md: 356, lg: 394 },
      top: { sm: -32, md: -42, lg: -52 },
      right: { sm: -12, md: -20, lg: -28 },
      transform: 'rotate(-4deg)',
    },
  },
  {
    id: 'storytellers',
    title: 'Рассказчики',
    description:
      'Мы подбираем, тестируем и оставляем только лучшие модели на роль гейм-мастера. GLM 5.0, DeepSeek V3.2, MiMo V2 Flash и Grok 4.1 Fast уже ждут, чтобы начать ваше приключение. Первые 20 ходов - бесплатно.',
    icon: advantageStorytellersIcon,
    preview: advantageTemplatesPreview,
    rowMinHeight: 228,
    previewSx: {
      width: { sm: 302, md: 336, lg: 366 },
      top: { sm: -50, md: -62, lg: -76 },
      right: { sm: -12, md: -18, lg: -26 },
      transform: 'rotate(8deg)',
    },
  },
  {
    id: 'images',
    title: 'Генерация картинок',
    description:
      'Визуализируйте сцену и переключайтесь между разными художниками: от экономичного Flux до выразительного Nano Banano.',
    icon: advantageImagesIcon,
    preview: advantageImagesPreview,
    rowMinHeight: 228,
    previewSx: {
      width: { sm: 252, md: 280, lg: 310 },
      top: { sm: -58, md: -74, lg: -86 },
      right: { sm: 0, md: -8, lg: -16 },
      transform: 'rotate(7deg)',
    },
  },
  {
    id: 'community',
    title: 'Сообщество',
    description:
      'Не хочется придумывать все с нуля? Делитесь персонажами, мирами и инструкциями, добавляйте к себе карточки других игроков и собирайте свою библиотеку идей.',
    icon: advantageCommunityIcon,
    preview: advantageCommunityPreview,
    rowMinHeight: 228,
    previewSx: {
      width: { sm: 336, md: 380, lg: 420 },
      top: { sm: -40, md: -52, lg: -64 },
      right: { sm: -14, md: -22, lg: -30 },
      transform: 'rotate(-4deg)',
    },
  },
  {
    id: 'memory',
    title: 'Оптимизация памяти',
    description:
      'Надоело, что память забивается за пару ходов, а стоимость каждого шага растет слишком быстро? Мы реализовали механизм оптимизации памяти что поможет вам сохранить солы! Тратьте меньше, помните больше! ИИ самостоятельно работает с текстом и разбивает его так чтобы держать контекст как можно дольше. А самые важные моменты она отдельно выписывает в видимый вам блок памяти и помнит их даже когда забывает совсем уж старые детали!',
    icon: advantageMemoryIcon,
    preview: advantageMemoryPreview,
    rowMinHeight: 252,
    previewSx: {
      width: { sm: 260, md: 296, lg: 328 },
      top: { sm: -52, md: -68, lg: -82 },
      right: { sm: -4, md: -10, lg: -16 },
      transform: 'rotate(3deg)',
    },
  },
]

const footerSocialLinks: Array<{ label: string; href: string; external?: boolean }> = [
  { label: 'Вконтакте', href: 'https://vk.com/moriusai', external: true },
  { label: 'Телеграмм', href: 'https://t.me/+t2ueY4x_KvE4ZWEy', external: true },
]

const footerInfoLinks: Array<{ label: string; path: string }> = [
  { label: 'Политика конфиденциальности', path: '/privacy-policy' },
  { label: 'Пользовательское соглашение', path: '/terms-of-service' },
]

const ctaButtonSx = {
  minWidth: 140,
  minHeight: 40,
  borderRadius: 'var(--morius-radius)',
  px: 2.2,
  fontWeight: 700,
  fontSize: '0.9rem',
  color: '#12161d',
  backgroundColor: '#d7dfea',
  boxShadow: '0 10px 22px rgba(0, 0, 0, 0.3)',
  transition: 'transform 220ms ease, box-shadow 220ms ease, background-color 220ms ease',
  '&:hover': {
    backgroundColor: '#e5ecf4',
    transform: 'translateY(-1px)',
    boxShadow: '0 14px 28px rgba(0, 0, 0, 0.36)',
  },
}

type PublicLandingPageProps = {
  isAuthenticated: boolean
  onNavigate: (path: string) => void
  onGoHome: () => void
  onAuthSuccess: (payload: AuthResponse) => void
}

type RevealOnViewProps = {
  children: ReactNode
  delay?: number
  y?: number
  threshold?: number
  sx?: SxProps<Theme>
}

function RevealOnView({ children, delay = 0, y = 26, threshold = 0.2, sx }: RevealOnViewProps) {
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const node = nodeRef.current
    if (!node) {
      return
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
          transition:
            `opacity 700ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, ` +
            `transform 700ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
          willChange: 'opacity, transform',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  )
}

function PublicLandingPage({ isAuthenticated, onNavigate, onGoHome, onAuthSuccess }: PublicLandingPageProps) {
  const storySectionRef = useRef<HTMLElement | null>(null)
  const [animationStarted, setAnimationStarted] = useState(false)
  const [typedText, setTypedText] = useState('')
  const [promptText, setPromptText] = useState('')
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [authDialogMode, setAuthDialogMode] = useState<AuthMode>('login')

  useEffect(() => {
    const sectionNode = storySectionRef.current
    if (!sectionNode) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setAnimationStarted(true)
          observer.disconnect()
        }
      },
      { threshold: 0.2 },
    )

    observer.observe(sectionNode)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!animationStarted || typedText.length >= STORY_TEXT.length) {
      return
    }

    const nextChar = STORY_TEXT[typedText.length]
    const delay = /[,.!?]/.test(nextChar) ? 90 : nextChar === ' ' ? 14 : 20
    const timeoutId = window.setTimeout(() => {
      setTypedText(STORY_TEXT.slice(0, typedText.length + 1))
    }, delay)

    return () => window.clearTimeout(timeoutId)
  }, [animationStarted, typedText])

  const isTyping = animationStarted && typedText.length < STORY_TEXT.length

  const openAuthDialog = (mode: AuthMode) => {
    if (isAuthenticated) {
      onGoHome()
      return
    }
    setAuthDialogMode(mode)
    setAuthDialogOpen(true)
  }

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100svh',
        overflow: 'hidden',
        color: '#d9dde4',
        backgroundColor: '#02040a',
        backgroundImage:
          'radial-gradient(circle at 70% 15%, rgba(168, 110, 56, 0.16) 0%, rgba(168, 110, 56, 0.04) 32%, transparent 55%), linear-gradient(180deg, #080b12 0%, #03050a 44%, #02040a 100%)',
      }}
    >
      <Box
        component="section"
        sx={{
          minHeight: '100svh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          textAlign: 'center',
          px: 3,
          pt: { xs: 10, md: 12 },
          pb: { xs: 13, md: 15 },
          zIndex: 1,
          backgroundImage: `linear-gradient(180deg, rgba(4, 5, 8, 0.52) 0%, rgba(4, 5, 9, 0.8) 56%, rgba(3, 4, 8, 0.98) 100%), url(${heroBackground})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, rgba(4, 6, 10, 0.95) 0%, rgba(4, 6, 10, 0.34) 22%, rgba(4, 6, 10, 0.28) 78%, rgba(4, 6, 10, 0.95) 100%)',
            pointerEvents: 'none',
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at 53% 32%, rgba(191, 123, 57, 0.24) 0%, rgba(191, 123, 57, 0.07) 33%, transparent 70%), linear-gradient(180deg, transparent 55%, rgba(4, 6, 10, 0.76) 76%, rgba(4, 6, 10, 0.97) 100%)',
            pointerEvents: 'none',
          },
        }}
        >
          <Container maxWidth="md" sx={{ position: 'relative', zIndex: 2 }}>
            <Box
              sx={{
                position: 'absolute',
                top: { xs: 6, sm: 10, md: 14 },
                right: { xs: 12, sm: 20, md: 28 },
                px: { xs: 1.2, md: 1.5 },
                py: { xs: 0.45, md: 0.55 },
                borderRadius: '999px',
                border: '1px solid rgba(228, 196, 149, 0.56)',
                background: 'linear-gradient(135deg, rgba(67, 50, 30, 0.82) 0%, rgba(35, 28, 20, 0.9) 100%)',
                color: '#f0dbc2',
                fontWeight: 800,
                fontSize: { xs: '0.74rem', md: '0.78rem' },
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                boxShadow: '0 10px 24px rgba(0, 0, 0, 0.34)',
                backdropFilter: 'blur(3px)',
              }}
            >
              Beta
            </Box>
            <Stack spacing={{ xs: 2.8, md: 3.4 }} alignItems="center">
            <Box
              component="img"
              src={brandLogo}
              alt="Morius"
              sx={{
                width: { xs: 252, sm: 318, md: 368 },
                maxWidth: '92%',
                animation: 'morius-fade-up 620ms cubic-bezier(0.22, 1, 0.36, 1) both',
              }}
            />
            <Typography
              variant="h2"
              sx={{
                maxWidth: 780,
                fontSize: { xs: '2.05rem', md: '2.95rem' },
                lineHeight: 1.22,
                color: '#d8dce4',
                animation: 'morius-fade-up 700ms cubic-bezier(0.22, 1, 0.36, 1) both',
                animationDelay: '90ms',
              }}
            >
              Твой ход. История начинается сейчас
            </Typography>
            <Typography
              sx={{
                maxWidth: 680,
                color: 'rgba(215, 220, 230, 0.74)',
                fontSize: { xs: '0.93rem', md: '0.99rem' },
                lineHeight: 1.5,
                animation: 'morius-fade-up 740ms cubic-bezier(0.22, 1, 0.36, 1) both',
                animationDelay: '150ms',
              }}
            >
              Текстовое приключение, где ИИ ведёт игру, а ты решаешь, кем стать и как закончится
              история.
            </Typography>
            <Button
              variant="contained"
              onClick={() => openAuthDialog('login')}
              sx={{
                ...ctaButtonSx,
                animation: 'morius-fade-up 760ms cubic-bezier(0.22, 1, 0.36, 1) both',
                animationDelay: '210ms',
              }}
            >
              Начать играть
            </Button>
          </Stack>
        </Container>
      </Box>

      <Box aria-hidden sx={{ position: 'relative', height: 0, zIndex: 3, pointerEvents: 'none' }}>
        <Box
          sx={{
            position: 'absolute',
            left: '50%',
            top: { xs: -182, sm: -198, md: -224, lg: -240 },
            transform: 'translateX(-50%)',
            width: { xs: '248%', sm: '216%', md: '184%', lg: '168%' },
            height: { xs: 430, sm: 470, md: 528, lg: 560 },
            overflow: 'hidden',
            pointerEvents: 'none',
            WebkitMaskImage:
              'linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.3) 14%, #000 30%, #000 74%, rgba(0, 0, 0, 0.6) 90%, transparent 100%)',
            maskImage:
              'linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.3) 14%, #000 30%, #000 74%, rgba(0, 0, 0, 0.6) 90%, transparent 100%)',
          }}
        >
          <Box
            component="img"
            src={heroClouds}
            alt=""
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: '50% 58%',
              opacity: 0.86,
              filter: 'grayscale(1) brightness(0.7) contrast(1.2)',
            }}
          />
          <Box
            component="img"
            src={heroClouds}
            alt=""
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: '50% 64%',
              opacity: 0.56,
              filter: 'grayscale(1) blur(7px) brightness(0.9) contrast(1.1)',
            }}
          />
          <Box
            component="img"
            src={heroClouds}
            alt=""
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: '50% 48%',
              opacity: 0.34,
              filter: 'grayscale(1) blur(14px) brightness(1.06)',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(180deg, rgba(4, 6, 10, 0.06) 0%, rgba(4, 6, 10, 0.34) 54%, rgba(2, 4, 9, 0.9) 100%)',
            }}
          />
        </Box>
      </Box>

      <Box
        component="section"
        sx={{
          position: 'relative',
          zIndex: 2,
          py: { xs: 9, md: 11.5 },
          background:
            'linear-gradient(180deg, rgba(5, 8, 14, 0.9) 0%, rgba(4, 7, 12, 0.98) 20%, rgba(3, 5, 9, 1) 100%), radial-gradient(circle at 18% 14%, rgba(76, 95, 122, 0.16) 0%, transparent 45%), repeating-linear-gradient(118deg, rgba(166, 186, 209, 0.025) 0, rgba(166, 186, 209, 0.025) 1px, transparent 1px, transparent 36px)',
        }}
      >
        <Container maxWidth="lg" sx={{ width: '100%' }}>
          <Stack spacing={{ xs: 5.4, md: 6.8 }} alignItems="center">
            <RevealOnView>
              <Stack spacing={1.3} alignItems="center" textAlign="center">
                <Typography variant="h2" sx={{ fontSize: { xs: '1.95rem', md: '2.72rem' }, color: '#d7dce4' }}>
                  Преимущества и особенности
                </Typography>
                <Typography
                  sx={{
                    maxWidth: 820,
                    color: 'rgba(214, 221, 231, 0.62)',
                    fontSize: { xs: '0.9rem', md: '0.98rem' },
                    lineHeight: 1.6,
                  }}
                >
                  Ты описываешь свои действия - ИИ ведет твою игру как ГМ
                </Typography>
              </Stack>
            </RevealOnView>

            <Box
              sx={{
                width: '100%',
                position: 'relative',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: { md: 12 },
                  bottom: { md: 12 },
                  left: '50%',
                  width: '1px',
                  transform: 'translateX(-50%)',
                  background:
                    'linear-gradient(180deg, rgba(145, 163, 184, 0) 0%, rgba(145, 163, 184, 0.23) 14%, rgba(145, 163, 184, 0.16) 84%, rgba(145, 163, 184, 0) 100%)',
                  boxShadow: '0 0 20px rgba(121, 142, 162, 0.2)',
                  opacity: { xs: 0, md: 1 },
                  pointerEvents: 'none',
                },
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  top: { md: 26 },
                  bottom: { md: 26 },
                  left: '50%',
                  width: 36,
                  transform: 'translateX(-50%)',
                  background:
                    'linear-gradient(180deg, rgba(129, 149, 171, 0) 0%, rgba(129, 149, 171, 0.18) 25%, rgba(129, 149, 171, 0.12) 76%, rgba(129, 149, 171, 0) 100%)',
                  filter: 'blur(10px)',
                  opacity: { xs: 0, md: 0.4 },
                  pointerEvents: 'none',
                },
              }}
            >
              <Stack spacing={{ xs: 5.5, sm: 7.2, md: 8.2 }} sx={{ position: 'relative', zIndex: 1 }}>
                {advantageCards.map((card, index) => (
                  <RevealOnView key={card.id} delay={index * 85} y={34} threshold={0.14}>
                    <Box
                      sx={{
                        position: 'relative',
                        minHeight: { sm: card.rowMinHeight },
                        isolation: 'isolate',
                      }}
                    >
                      <Card
                        sx={{
                          position: 'relative',
                          overflow: 'visible',
                          borderRadius: '14px',
                          border: '1px solid rgba(170, 187, 210, 0.16)',
                          background: 'linear-gradient(170deg, rgba(11, 15, 23, 0.96) 0%, rgba(8, 12, 18, 0.94) 100%)',
                          boxShadow: '0 16px 30px rgba(0, 0, 0, 0.3)',
                          backdropFilter: 'blur(2px)',
                        }}
                      >
                        <CardContent
                          sx={{
                            p: { xs: 2.2, sm: 2.8, md: 3.1 },
                            pr: { xs: 2.2, sm: '40%', md: '44%', lg: '48%' },
                            minHeight: { sm: card.rowMinHeight },
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Stack spacing={{ xs: 1.2, md: 1.65 }}>
                            <Stack direction="row" spacing={1.15} alignItems="center">
                              <Typography
                                variant="h3"
                                sx={{
                                  color: '#dce2eb',
                                  fontSize: { xs: '1.7rem', sm: '2rem', md: '2.22rem' },
                                  lineHeight: 1.18,
                                  fontWeight: 700,
                                  letterSpacing: '-0.01em',
                                }}
                              >
                                {card.title}
                              </Typography>
                              <Box
                                component="img"
                                src={card.icon}
                                alt=""
                                sx={{
                                  width: { xs: 18, sm: 20 },
                                  height: { xs: 18, sm: 20 },
                                  objectFit: 'contain',
                                  flexShrink: 0,
                                }}
                              />
                            </Stack>
                            <Typography
                              sx={{
                                color: 'rgba(214, 221, 231, 0.82)',
                                lineHeight: 1.56,
                                fontSize: { xs: '0.94rem', md: '0.99rem' },
                                maxWidth: { xs: '100%', sm: 470, md: 520 },
                              }}
                            >
                              {card.description}
                            </Typography>
                          </Stack>
                        </CardContent>

                        <Box
                          aria-hidden
                          sx={{
                            display: { xs: 'none', md: 'block' },
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            width: { md: 88, lg: 108 },
                            height: 58,
                            transform: 'translate(0, -50%)',
                            borderTop: '1px solid rgba(150, 167, 189, 0.16)',
                            borderRight: '1px solid rgba(150, 167, 189, 0.1)',
                            borderTopRightRadius: '58px',
                            opacity: 0.8,
                            pointerEvents: 'none',
                          }}
                        />
                      </Card>

                      <Box
                        component="img"
                        src={card.preview}
                        alt=""
                        aria-hidden
                        sx={[
                          {
                            display: { xs: 'none', sm: 'block' },
                            position: 'absolute',
                            zIndex: 2,
                            maxWidth: 'none',
                            pointerEvents: 'none',
                            userSelect: 'none',
                            filter: 'drop-shadow(0 24px 34px rgba(0, 0, 0, 0.62))',
                          },
                          card.previewSx,
                        ]}
                      />
                    </Box>
                  </RevealOnView>
                ))}
              </Stack>
            </Box>
          </Stack>
        </Container>
      </Box>

      <Box
        component="section"
        ref={storySectionRef}
        sx={{
          minHeight: '100svh',
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          pt: { xs: 12, sm: 14, md: 16 },
          pb: { xs: 10, md: 12 },
          background:
            'linear-gradient(180deg, rgba(4, 7, 12, 0.98) 0%, #02040a 24%, #02040a 100%), repeating-linear-gradient(120deg, rgba(255,255,255,0.008) 0, rgba(255,255,255,0.008) 1px, transparent 1px, transparent 32px)',
        }}
      >
        <Container maxWidth="lg" sx={{ width: '100%', position: 'relative', zIndex: 2 }}>
          <Stack spacing={{ xs: 5, md: 7 }} alignItems="center">
              <Typography
                variant="h2"
                sx={{
                  fontSize: { xs: '2rem', md: '3.05rem' },
                  textAlign: 'center',
                  lineHeight: 1.25,
                  maxWidth: 620,
                  color: '#d3d8e0',
                }}
              >
                Ваше приключение начинается здесь и сейчас
              </Typography>

              <Box sx={{ width: '100%', maxWidth: 770 }}>
                <Box sx={{ minHeight: { xs: 120, md: 132 }, mb: 2.8 }}>
                  <Typography
                    sx={{
                      color: 'rgba(217, 222, 232, 0.86)',
                      lineHeight: 1.62,
                      fontSize: { xs: '0.97rem', md: '1rem' },
                    }}
                  >
                    {typedText}
                    {isTyping ? (
                      <Box component="span" className="typing-caret" sx={{ ml: 0.2 }}>
                        |
                      </Box>
                    ) : null}
                  </Typography>
                </Box>

                <Box
                  sx={{
                    borderRadius: '12px',
                    border: 'var(--morius-border-width) solid rgba(185, 198, 214, 0.18)',
                    background: 'linear-gradient(180deg, rgba(18, 21, 28, 0.9) 0%, rgba(14, 17, 23, 0.86) 100%)',
                    boxShadow: '0 18px 30px rgba(0, 0, 0, 0.34)',
                  }}
                >
                  <Box
                    component="textarea"
                    value={promptText}
                    onChange={(event) => setPromptText(event.target.value.slice(0, LANDING_PROMPT_MAX_LENGTH))}
                    placeholder="Что же будете делать дальше?"
                    rows={3}
                    maxLength={LANDING_PROMPT_MAX_LENGTH}
                    spellCheck={false}
                    sx={{
                      display: 'block',
                      width: '100%',
                      minHeight: { xs: 80, md: 90 },
                      border: 'none',
                      outline: 'none',
                      resize: 'none',
                      p: '12px 14px',
                      backgroundColor: 'transparent',
                      color: '#dde2ea',
                      fontFamily: 'inherit',
                      fontSize: { xs: '0.94rem', md: '0.99rem' },
                      lineHeight: 1.5,
                      '&::placeholder': {
                        color: 'rgba(220, 226, 236, 0.5)',
                        opacity: 1,
                      },
                    }}
                  />
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={0.1}
                    sx={{
                      borderTop: 'var(--morius-border-width) solid rgba(185, 198, 214, 0.14)',
                      p: '5px 9px',
                    }}
                  >
                    <Stack direction="row" alignItems="center" spacing={0.4} sx={{ pl: 0.6, pr: 0.8 }}>
                      <Box component="img" src={icons.tabcoin} alt="sol count" sx={{ width: 12, height: 12 }} />
                      <Typography sx={{ fontSize: '1.42rem', lineHeight: 1, color: 'rgba(211, 217, 228, 0.85)' }}>
                        5
                      </Typography>
                    </Stack>
                    <IconButton
                      size="small"
                      aria-label="back"
                      sx={{ transition: 'transform 160ms ease', '&:hover': { transform: 'translateY(-1px)' } }}
                    >
                      <Box component="img" src={icons.back} alt="" sx={{ width: 15, height: 15 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="undo"
                      sx={{ transition: 'transform 160ms ease', '&:hover': { transform: 'translateY(-1px)' } }}
                    >
                      <Box component="img" src={icons.undo} alt="" sx={{ width: 15, height: 15 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="reroll"
                      sx={{ transition: 'transform 160ms ease', '&:hover': { transform: 'translateY(-1px)' } }}
                    >
                      <Box component="img" src={icons.reroll} alt="" sx={{ width: 15, height: 15 }} />
                    </IconButton>
                    <Box sx={{ flexGrow: 1 }} />
                    <Box sx={{ minWidth: 108, pr: 0.6 }}>
                      <TextLimitIndicator currentLength={promptText.length} maxLength={LANDING_PROMPT_MAX_LENGTH} />
                    </Box>
                    <IconButton
                      size="small"
                      aria-label="send disabled"
                      onClick={(event) => event.preventDefault()}
                      sx={{
                        width: 32,
                        height: 32,
                        backgroundColor: '#d7dfea',
                        transition: 'transform 180ms ease, background-color 180ms ease',
                        '&:hover': {
                          backgroundColor: '#e5ecf4',
                          transform: 'translateY(-1px)',
                        },
                      }}
                    >
                      <Box component="img" src={icons.send} alt="" sx={{ width: 14, height: 14 }} />
                    </IconButton>
                  </Stack>
                </Box>

                <Box sx={{ textAlign: 'center', mt: 4.5 }}>
                  <Button variant="contained" onClick={() => openAuthDialog('register')} sx={ctaButtonSx}>
                    Начать играть
                  </Button>
                </Box>
              </Box>
          </Stack>
        </Container>
      </Box>

      <Box component="section" sx={{ minHeight: '92svh', display: 'flex', alignItems: 'center', py: { xs: 10, md: 12 } }}>
        <Container maxWidth="lg" sx={{ width: '100%' }}>
          <Stack spacing={6} alignItems="center">
            <RevealOnView>
              <Stack spacing={1.25} alignItems="center" textAlign="center">
                <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '2.92rem' }, color: '#d3d8e0' }}>
                  Как устроена игра
                </Typography>
                <Typography
                  sx={{
                    maxWidth: 760,
                    color: 'rgba(214, 221, 231, 0.64)',
                    fontSize: { xs: '0.92rem', md: '0.98rem' },
                  }}
                >
                  Ты выбираешь действия. ИИ ведет мир: описывает сцены, персонажей и последствия.
                </Typography>
              </Stack>
            </RevealOnView>

            <Box
              sx={{
                width: '100%',
                display: 'grid',
                gap: 2.4,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  md: 'repeat(3, minmax(0, 1fr))',
                },
              }}
            >
              {featureCards.map((feature, index) => (
                <RevealOnView key={feature.id} delay={index * 95} y={30} threshold={0.18}>
                  <Card
                    sx={{
                      background: 'linear-gradient(180deg, rgba(16, 19, 26, 0.94) 0%, rgba(13, 16, 22, 0.92) 100%)',
                      border: 'var(--morius-border-width) solid rgba(185, 198, 214, 0.16)',
                      minHeight: { xs: 222, md: 236 },
                      borderRadius: 'var(--morius-radius)',
                      transition:
                        'transform 280ms cubic-bezier(0.22, 1, 0.36, 1), border-color 280ms ease, box-shadow 280ms ease, background-color 280ms ease',
                      boxShadow: '0 12px 24px rgba(0, 0, 0, 0.2)',
                      '&:hover': {
                        transform: 'translateY(-7px)',
                        borderColor: 'rgba(185, 198, 214, 0.34)',
                        backgroundColor: 'rgba(18, 22, 30, 0.96)',
                        boxShadow: '0 20px 34px rgba(0, 0, 0, 0.3)',
                      },
                      '&:hover .feature-icon': {
                        transform: 'translateY(-2px) scale(1.05)',
                      },
                    }}
                  >
                    <CardContent
                      sx={{
                        p: 3,
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100%',
                      }}
                    >
                      <Box
                        component="img"
                        className="feature-icon"
                        src={feature.icon}
                        alt={feature.title}
                        sx={{
                          width: 44,
                          height: 44,
                          mb: 2.1,
                          objectFit: 'contain',
                          transition: 'transform 260ms ease',
                          filter:
                            feature.id === 'pay'
                              ? 'brightness(0) saturate(100%) invert(88%) sepia(10%) saturate(262%) hue-rotate(174deg) brightness(90%) contrast(91%)'
                              : 'none',
                        }}
                      />
                      <Typography variant="h6" sx={{ mb: 1.2, fontSize: '1.28rem', fontWeight: 700, color: '#d8dde5' }}>
                        {feature.title}
                      </Typography>
                      <Typography sx={{ color: 'rgba(213, 220, 231, 0.62)', lineHeight: 1.54, fontSize: '0.9rem' }}>
                        {feature.description}
                      </Typography>
                    </CardContent>
                  </Card>
                </RevealOnView>
              ))}
            </Box>

            <RevealOnView delay={120}>
              <Stack spacing={1.1} alignItems="center" textAlign="center" sx={{ pt: { xs: 0.8, md: 1.2 } }}>
                <Typography variant="h3" sx={{ fontSize: { xs: '1.6rem', md: '2.1rem' }, color: '#d3d8e0' }}>
                  Тарифные планы
                </Typography>
                <Typography sx={{ color: 'rgba(214, 221, 231, 0.62)', fontSize: { xs: '0.9rem', md: '0.95rem' } }}>
                  Выберите пакет солов под ваш темп игры.
                </Typography>
              </Stack>
            </RevealOnView>

            <Box
              sx={{
                width: '100%',
                display: 'grid',
                gap: 2.1,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  lg: 'repeat(4, minmax(0, 1fr))',
                },
              }}
            >
              {tariffPlans.map((plan, index) => (
                <RevealOnView key={plan.id} delay={index * 95 + 180} y={30} threshold={0.18}>
                  <Card
                    sx={{
                      background: plan.isHighlighted
                        ? 'linear-gradient(180deg, rgba(39, 49, 62, 0.92) 0%, rgba(28, 35, 46, 0.92) 100%)'
                        : 'linear-gradient(180deg, rgba(18, 22, 30, 0.94) 0%, rgba(14, 18, 25, 0.92) 100%)',
                      border: plan.isHighlighted
                        ? 'var(--morius-border-width) solid rgba(188, 208, 227, 0.42)'
                        : 'var(--morius-border-width) solid rgba(185, 198, 214, 0.16)',
                      borderRadius: 'var(--morius-radius)',
                      minHeight: { xs: 188, md: 202 },
                      transition:
                        'transform 280ms cubic-bezier(0.22, 1, 0.36, 1), border-color 280ms ease, box-shadow 280ms ease, background-color 280ms ease',
                      boxShadow: plan.isHighlighted
                        ? '0 16px 28px rgba(0, 0, 0, 0.28)'
                        : '0 12px 24px rgba(0, 0, 0, 0.2)',
                      '&:hover': {
                        transform: 'translateY(-7px)',
                        borderColor: plan.isHighlighted ? 'rgba(188, 208, 227, 0.66)' : 'rgba(185, 198, 214, 0.34)',
                        backgroundColor: plan.isHighlighted ? 'rgba(35, 44, 56, 0.96)' : 'rgba(20, 24, 33, 0.96)',
                        boxShadow: '0 20px 34px rgba(0, 0, 0, 0.3)',
                      },
                    }}
                  >
                    <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
                      <Stack spacing={1.05} alignItems="flex-start">
                        {plan.isHighlighted ? (
                          <Typography
                            sx={{
                              borderRadius: '999px',
                              px: 1.1,
                              py: 0.32,
                              color: '#e8f0fa',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              letterSpacing: '0.05em',
                              textTransform: 'uppercase',
                              backgroundColor: 'rgba(158, 182, 206, 0.22)',
                              border: '1px solid rgba(197, 214, 230, 0.34)',
                            }}
                          >
                            {plan.badge ?? 'Популярный'}
                          </Typography>
                        ) : null}
                        <Typography sx={{ color: '#d8dde5', fontSize: '1.35rem', fontWeight: 700 }}>
                          {plan.title}
                        </Typography>
                        <Typography sx={{ color: '#e6edf6', fontSize: '1.95rem', fontWeight: 800, lineHeight: 1.12 }}>
                          {plan.price}
                        </Typography>
                        <Typography sx={{ color: 'rgba(213, 220, 231, 0.72)', fontSize: '0.95rem' }}>
                          {plan.coins}
                        </Typography>
                      </Stack>
                    </CardContent>
                  </Card>
                </RevealOnView>
              ))}
            </Box>
          </Stack>
        </Container>
      </Box>

      <Box component="section" sx={{ minHeight: '62svh', display: 'grid', placeItems: 'center', px: 3, py: { xs: 8, md: 10 } }}>
        <RevealOnView>
          <Stack spacing={1.25} alignItems="center" textAlign="center">
            <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '2.82rem' }, maxWidth: 760, color: '#d3d8e0' }}>
              Готов сделать первый ход?
            </Typography>
            <Typography sx={{ color: 'rgba(214, 221, 231, 0.62)', fontSize: { xs: '0.92rem', md: '0.98rem' } }}>
              Зарегистрируйся и начни играть
            </Typography>
            <Button
              variant="contained"
              onClick={() => openAuthDialog('register')}
              sx={{ ...ctaButtonSx, mt: 0.8 }}
            >
              Начать играть
            </Button>
          </Stack>
        </RevealOnView>
      </Box>

      <Footer socialLinks={footerSocialLinks} infoLinks={footerInfoLinks} onNavigate={onNavigate} />

      <AuthDialog
        open={authDialogOpen}
        initialMode={authDialogMode}
        onClose={() => setAuthDialogOpen(false)}
        onAuthSuccess={onAuthSuccess}
      />
    </Box>
  )
}

export default PublicLandingPage
