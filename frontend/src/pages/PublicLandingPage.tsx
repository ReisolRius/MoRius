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
import { brandLogo, heroBackground, heroClouds, icons } from '../assets'
import AuthDialog, { type AuthMode } from '../components/AuthDialog'
import type { AuthResponse } from '../types/auth'

const STORY_TEXT =
  'Трактирщик с грохотом ставит перед вами деревянную кружку, пена стекает по краям. «Пять медных, странник», - бурчит он. В этот момент музыка стихает, и вы чувствуете тяжелую руку на своем плече. Это один из местных наемников, и он выглядит недружелюбно.'

const featureCards = [
  {
    id: 'choice',
    title: 'Твой выбор имеет вес',
    description:
      'Здесь нельзя ошибиться. Каждое решение - от случайной фразы до боя с драконом - меняет мир вокруг. Один жест может открыть новый путь или привести к проблемам.',
    icon: icons.like,
  },
  {
    id: 'living-world',
    title: 'Живой мир за сценой',
    description:
      'ИИ не просто пишет текст. Он отслеживает отношения, фракции, погоду и последствия. Если герой в долгу - трактир полон слухов, а стража смотрит иначе.',
    icon: icons.settings,
  },
  {
    id: 'coauthor',
    title: 'Ты автор, ИИ - соавтор',
    description:
      'Опиши действие своими словами: "Хочу обмануть стражу" или "Ищу древний фолиант". ИИ поймет мысль и развернет сцену в полноценное приключение.',
    icon: icons.send,
  },
  {
    id: 'tokens',
    title: 'Платишь только за игру',
    description:
      'Покупаешь токены - получаешь личные приключения без подписок и скрытых списаний. Ты контролируешь бюджет, а история подстраивается под твой темп.',
    icon: icons.coin,
  },
]

const footerLinks = ['О проекте', 'телеграм', 'Вконтакте']

type PublicLandingPageProps = {
  isAuthenticated: boolean
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

function PublicLandingPage({ isAuthenticated, onGoHome, onAuthSuccess }: PublicLandingPageProps) {
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
      { threshold: 0.4 },
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
        backgroundColor: '#040507',
        backgroundImage:
          'radial-gradient(circle at 72% 22%, rgba(182, 108, 42, 0.08), transparent 24%), linear-gradient(180deg, rgba(8, 11, 16, 0.94) 0%, rgba(4, 6, 10, 0.98) 100%)',
        color: 'text.primary',
        minHeight: '100svh',
        overflow: 'hidden',
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
          zIndex: 2,
          textAlign: 'center',
          px: 3,
          py: { xs: 10, md: 12 },
          backgroundImage: `linear-gradient(180deg, rgba(3, 5, 8, 0.42) 0%, rgba(3, 5, 8, 0.72) 54%, rgba(4, 5, 7, 0.98) 100%), url(${heroBackground})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, rgba(3, 5, 8, 0.94) 0%, rgba(3, 5, 8, 0.36) 23%, rgba(3, 5, 8, 0.28) 78%, rgba(3, 5, 8, 0.94) 100%)',
            pointerEvents: 'none',
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at 55% 36%, rgba(195, 121, 44, 0.24) 0%, rgba(195, 121, 44, 0.08) 34%, transparent 70%), linear-gradient(180deg, transparent 54%, #040507 96%)',
            pointerEvents: 'none',
          },
        }}
      >
        <Container maxWidth="md" sx={{ position: 'relative', zIndex: 2 }}>
          <Stack spacing={{ xs: 2.8, md: 3.4 }} alignItems="center">
            <Box
              component="img"
              src={brandLogo}
              alt="Morius"
              sx={{
                width: { xs: 250, sm: 322, md: 362 },
                maxWidth: '92%',
                animation: 'morius-fade-up 620ms cubic-bezier(0.22, 1, 0.36, 1) both',
              }}
            />
            <Typography
              variant="h2"
              sx={{
                maxWidth: 760,
                fontSize: { xs: '2.05rem', md: '2.95rem' },
                lineHeight: 1.22,
                animation: 'morius-fade-up 700ms cubic-bezier(0.22, 1, 0.36, 1) both',
                animationDelay: '90ms',
              }}
            >
              Твой ход, герой. ИИ уже ждет.
            </Typography>
            <Typography
              sx={{
                maxWidth: 620,
                color: 'text.secondary',
                fontSize: { xs: '0.95rem', md: '1rem' },
                lineHeight: 1.5,
                animation: 'morius-fade-up 740ms cubic-bezier(0.22, 1, 0.36, 1) both',
                animationDelay: '150ms',
              }}
            >
              Это не просто игра по сценарию. Это живой мир, который дышит и меняется благодаря тебе.
            </Typography>
            <Button
              variant="contained"
              onClick={() => openAuthDialog('login')}
              sx={{
                minWidth: 150,
                minHeight: 42,
                backgroundColor: 'primary.main',
                color: '#171716',
                animation: 'morius-fade-up 760ms cubic-bezier(0.22, 1, 0.36, 1) both',
                animationDelay: '210ms',
                transition: 'transform 220ms ease, box-shadow 220ms ease, background-color 220ms ease',
                boxShadow: '0 10px 24px rgba(0, 0, 0, 0.28)',
                '&:hover': {
                  backgroundColor: '#edf4fc',
                  transform: 'translateY(-2px)',
                  boxShadow: '0 16px 30px rgba(0, 0, 0, 0.35)',
                },
              }}
            >
              Начать играть
            </Button>
          </Stack>
        </Container>

        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: '50%',
            bottom: { xs: -96, sm: -112, md: -142, lg: -166 },
            transform: 'translateX(-50%)',
            width: { xs: '240%', sm: '188%', md: '150%', lg: '136%' },
            height: { xs: 290, sm: 340, md: 410, lg: 446 },
            overflow: 'hidden',
            zIndex: 1,
            pointerEvents: 'none',
            WebkitMaskImage:
              'linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.58) 16%, #000 34%, #000 73%, rgba(0, 0, 0, 0.58) 88%, transparent 100%)',
            maskImage:
              'linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.58) 16%, #000 34%, #000 73%, rgba(0, 0, 0, 0.58) 88%, transparent 100%)',
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
              objectPosition: '50% 49%',
              opacity: 0.9,
              filter: 'grayscale(1) contrast(1.2) brightness(1.16)',
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
              objectPosition: '50% 63%',
              opacity: 0.72,
              mixBlendMode: 'screen',
              filter: 'grayscale(1) blur(2.6px) contrast(1.16) brightness(1.28)',
            }}
          />
        </Box>
      </Box>

      <Box
        component="section"
        ref={storySectionRef}
        sx={{
          minHeight: '100svh',
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          pt: { xs: 19, sm: 21, md: 24 },
          pb: { xs: 8, md: 9 },
          background:
            'linear-gradient(180deg, #040507 0%, rgba(5, 7, 11, 0.96) 34%, rgba(5, 7, 11, 0.94) 100%), repeating-linear-gradient(120deg, rgba(255,255,255,0.012) 0, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 30px)',
        }}
      >
        <Container maxWidth="lg" sx={{ width: '100%' }}>
          <RevealOnView>
            <Stack spacing={{ xs: 5, md: 7 }} alignItems="center">
              <Typography
                variant="h2"
                sx={{
                  fontSize: { xs: '2rem', md: '3.05rem' },
                  textAlign: 'center',
                  maxWidth: 580,
                }}
              >
                Ваше приключение начинается здесь и сейчас
              </Typography>

              <Box sx={{ width: '100%', maxWidth: 860 }}>
                <Box sx={{ minHeight: { xs: 136, md: 148 }, mb: 3 }}>
                  <Typography sx={{ color: 'text.primary', lineHeight: 1.62, fontSize: { xs: '1rem', md: '1.08rem' } }}>
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
                    borderRadius: '14px',
                    border: '1px solid rgba(186, 202, 214, 0.12)',
                    background: 'linear-gradient(180deg, rgba(16, 18, 22, 0.88) 0%, rgba(17, 19, 22, 0.72) 100%)',
                    backdropFilter: 'blur(4px)',
                    boxShadow: '0 18px 34px rgba(0, 0, 0, 0.24)',
                  }}
                >
                  <Box
                    component="textarea"
                    value={promptText}
                    onChange={(event) => setPromptText(event.target.value)}
                    placeholder="Что вы будете делать дальше?"
                    rows={3}
                    spellCheck={false}
                    sx={{
                      display: 'block',
                      width: '100%',
                      minHeight: { xs: 82, md: 92 },
                      border: 'none',
                      outline: 'none',
                      resize: 'none',
                      p: '14px 16px',
                      backgroundColor: 'transparent',
                      color: 'text.primary',
                      fontFamily: 'inherit',
                      fontSize: { xs: '0.98rem', md: '1.04rem' },
                      lineHeight: 1.5,
                      '&::placeholder': {
                        color: 'rgba(223, 229, 239, 0.74)',
                        opacity: 1,
                      },
                    }}
                  />
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={0.2}
                    sx={{
                      borderTop: '1px solid rgba(186, 202, 214, 0.1)',
                      p: '6px 10px',
                    }}
                  >
                    <Stack direction="row" alignItems="center" spacing={0.45} sx={{ pl: 0.5, pr: 0.7 }}>
                      <Box component="img" src={icons.tabcoin} alt="coin count" sx={{ width: 12, height: 12 }} />
                      <Typography sx={{ fontSize: '1.48rem', lineHeight: 1, color: 'text.secondary' }}>5</Typography>
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
                    <IconButton
                      size="small"
                      aria-label="send disabled"
                      onClick={(event) => event.preventDefault()}
                      sx={{
                        width: 36,
                        height: 36,
                        backgroundColor: 'primary.main',
                        transition: 'transform 180ms ease, background-color 180ms ease',
                        '&:hover': {
                          backgroundColor: '#edf4fc',
                          transform: 'translateY(-1px)',
                        },
                      }}
                    >
                      <Box component="img" src={icons.send} alt="" sx={{ width: 16, height: 16 }} />
                    </IconButton>
                  </Stack>
                </Box>

                <Box sx={{ textAlign: 'center', mt: 5 }}>
                  <Button
                    variant="contained"
                    onClick={() => openAuthDialog('register')}
                    sx={{
                      minWidth: 170,
                      minHeight: 44,
                      backgroundColor: 'primary.main',
                      color: '#171716',
                      transition: 'transform 220ms ease, box-shadow 220ms ease, background-color 220ms ease',
                      boxShadow: '0 10px 24px rgba(0, 0, 0, 0.26)',
                      '&:hover': {
                        backgroundColor: '#edf4fc',
                        transform: 'translateY(-2px)',
                        boxShadow: '0 16px 28px rgba(0, 0, 0, 0.34)',
                      },
                    }}
                  >
                    Начать играть
                  </Button>
                </Box>
              </Box>
            </Stack>
          </RevealOnView>
        </Container>
      </Box>

      <Box component="section" sx={{ minHeight: '100svh', display: 'flex', alignItems: 'center', py: { xs: 8, md: 9 } }}>
        <Container maxWidth="lg" sx={{ width: '100%' }}>
          <Stack spacing={6} alignItems="center">
            <RevealOnView>
              <Stack spacing={1.3} alignItems="center" textAlign="center">
                <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '3rem' } }}>
                  Как работает твое приключение
                </Typography>
                <Typography
                  sx={{
                    maxWidth: 760,
                    color: 'text.secondary',
                    fontSize: { xs: '0.95rem', md: '1rem' },
                  }}
                >
                  Здесь нет сценариев и рельсов. Только чистый лист твоей фантазии и бесконечные миры, которые ИИ
                  создает специально для тебя.
                </Typography>
              </Stack>
            </RevealOnView>

            <Box
              sx={{
                width: '100%',
                display: 'grid',
                gap: 2.6,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  lg: 'repeat(4, minmax(0, 1fr))',
                },
              }}
            >
              {featureCards.map((feature, index) => (
                <RevealOnView key={feature.id} delay={index * 95} y={30} threshold={0.18}>
                  <Card
                    sx={{
                      backgroundColor: 'rgba(10, 13, 18, 0.84)',
                      border: '1px solid rgba(186, 202, 214, 0.08)',
                      minHeight: 312,
                      transition:
                        'transform 280ms cubic-bezier(0.22, 1, 0.36, 1), border-color 280ms ease, box-shadow 280ms ease, background-color 280ms ease',
                      boxShadow: '0 12px 24px rgba(0, 0, 0, 0.18)',
                      '&:hover': {
                        transform: 'translateY(-8px)',
                        borderColor: 'rgba(186, 202, 214, 0.22)',
                        backgroundColor: 'rgba(14, 18, 26, 0.9)',
                        boxShadow: '0 22px 34px rgba(0, 0, 0, 0.28)',
                      },
                      '&:hover .feature-icon': {
                        transform: 'translateY(-2px) scale(1.06)',
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
                          width: 54,
                          height: 54,
                          mb: 2.2,
                          objectFit: 'contain',
                          transition: 'transform 260ms ease',
                          filter:
                            feature.id === 'coauthor'
                              ? 'brightness(0) saturate(100%) invert(82%) sepia(8%) saturate(330%) hue-rotate(173deg) brightness(92%) contrast(91%)'
                              : 'none',
                        }}
                      />
                      <Typography variant="h6" sx={{ mb: 1.4, fontSize: '1.32rem', fontWeight: 700 }}>
                        {feature.title}
                      </Typography>
                      <Typography sx={{ color: 'text.secondary', lineHeight: 1.55, fontSize: '0.9rem' }}>
                        {feature.description}
                      </Typography>
                    </CardContent>
                  </Card>
                </RevealOnView>
              ))}
            </Box>
          </Stack>
        </Container>
      </Box>

      <Box component="section" sx={{ minHeight: '70svh', display: 'grid', placeItems: 'center', px: 3, py: { xs: 8, md: 10 } }}>
        <RevealOnView>
          <Stack spacing={1.4} alignItems="center" textAlign="center">
            <Typography variant="h2" sx={{ fontSize: { xs: '2.05rem', md: '3.05rem' }, maxWidth: 760 }}>
              Скорее погрузись в мир приключений без ограничений!
            </Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: { xs: '0.94rem', md: '1rem' } }}>
              Зарегистрируйся и начни свою игру
            </Typography>
            <Button
              variant="contained"
              onClick={() => openAuthDialog('register')}
              sx={{
                minWidth: 150,
                minHeight: 42,
                backgroundColor: 'primary.main',
                color: '#171716',
                mt: 0.9,
                transition: 'transform 220ms ease, box-shadow 220ms ease, background-color 220ms ease',
                boxShadow: '0 10px 24px rgba(0, 0, 0, 0.26)',
                '&:hover': {
                  backgroundColor: '#edf4fc',
                  transform: 'translateY(-2px)',
                  boxShadow: '0 16px 28px rgba(0, 0, 0, 0.34)',
                },
              }}
            >
              Начать играть
            </Button>
          </Stack>
        </RevealOnView>
      </Box>

      <Box component="footer" sx={{ borderTop: '1px solid rgba(182, 196, 214, 0.12)', py: 4.5 }}>
        <Container maxWidth="lg">
          <RevealOnView>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="center"
              alignItems="center"
              spacing={{ xs: 1.4, sm: 5, md: 8 }}
              sx={{ mb: 2.2 }}
            >
              {footerLinks.map((link) => (
                <Typography
                  key={link}
                  component="a"
                  href="#"
                  sx={{
                    color: 'text.primary',
                    textDecoration: 'none',
                    fontWeight: 600,
                    transition: 'color 180ms ease, transform 180ms ease',
                    '&:hover': {
                      color: 'primary.main',
                      transform: 'translateY(-1px)',
                    },
                  }}
                >
                  {link}
                </Typography>
              ))}
            </Stack>
          </RevealOnView>
          <Typography sx={{ textAlign: 'center', color: 'text.secondary', fontSize: '0.84rem' }}>MoRius ©</Typography>
        </Container>
      </Box>

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
