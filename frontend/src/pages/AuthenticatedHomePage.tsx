import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type Ref,
} from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grow,
  IconButton,
  Stack,
  Typography,
  type AlertColor,
  type GrowProps,
} from '@mui/material'
import { brandLogo, icons } from '../assets'
import {
  createCoinTopUpPayment,
  getCoinTopUpPlans,
  syncCoinTopUpPayment,
  updateCurrentUserAvatar,
  type CoinTopUpPlan,
} from '../services/authApi'
import { createStoryGame } from '../services/storyApi'
import type { AuthUser } from '../types/auth'

type AuthenticatedHomePageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
}

type PaymentNotice = {
  severity: AlertColor
  text: string
}

type DashboardView = 'welcome' | 'updates'

type DashboardNewsItem = {
  id: string
  category: string
  title: string
  description: string
  dateLabel: string
}

type PresetWorld = {
  id: string
  title: string
  teaser: string
  description: string
  prompt: string
  artwork: string
}

const HEADER_AVATAR_SIZE = 44
const QUICK_START_WORLD_STORAGE_KEY = 'morius.quickstart.world'
const DASHBOARD_TABS: Array<{ value: DashboardView; label: string }> = [
  { value: 'welcome', label: 'Приветствие' },
  { value: 'updates', label: 'Обновления' },
]

const DASHBOARD_NEWS: DashboardNewsItem[] = [
  {
    id: 'news-1',
    category: 'Обновление',
    title: 'Новые стили карточек и быстрый старт',
    description: 'Интерфейс стал легче, а стартовые миры доступны в один клик прямо на главной странице.',
    dateLabel: '20 февраля 2026',
  },
  {
    id: 'news-2',
    category: 'Игровой процесс',
    title: 'Редактирование сообщений в истории',
    description: 'Теперь вы можете поправить любую реплику в текущей сессии и продолжить сюжет с новой развилки.',
    dateLabel: '19 февраля 2026',
  },
  {
    id: 'news-3',
    category: 'Профиль',
    title: 'Гибкая работа с аватаром',
    description: 'Добавление, замена и удаление аватара теперь доступны из профиля без перехода между страницами.',
    dateLabel: '18 февраля 2026',
  },
]

const PRESET_WORLDS: PresetWorld[] = [
  {
    id: 'fantasy',
    title: 'Фэнтези',
    teaser: 'Древние королевства, магические ордена и забытые руины.',
    description:
      'Мир высоких гор, лунных лесов и старых трактов. Между княжествами идёт холодная война, а в тенях пробуждаются силы, которые когда-то считались легендой.',
    prompt:
      'Опиши вводную сцену в фэнтези-мире: старый тракт, вечер, близится гроза, вдалеке видны огни города-крепости.',
    artwork:
      'repeating-linear-gradient(24deg, hsla(42, 30%, 55%, 0.16) 0 12px, transparent 12px 28px), radial-gradient(circle at 78% 22%, hsla(40, 44%, 62%, 0.18), transparent 42%), linear-gradient(152deg, hsla(208, 34%, 17%, 0.98) 0%, hsla(219, 38%, 11%, 0.99) 100%)',
  },
  {
    id: 'cyberpunk',
    title: 'Киберпанк',
    teaser: 'Неоновые кварталы, корпорации и хаос нижнего города.',
    description:
      'Мегаполис под кислотным дождём. В небе висят рекламные дроны, а на уровне улиц власть делят синдикаты, уличные сети и корпоративные отделы безопасности.',
    prompt:
      'Опиши вступительную сцену в киберпанк-мире: ночной мегаполис, мокрые неоновые улицы, напряжение перед операцией.',
    artwork:
      'repeating-linear-gradient(118deg, hsla(195, 34%, 58%, 0.16) 0 10px, transparent 10px 24px), radial-gradient(circle at 16% 80%, hsla(207, 42%, 60%, 0.17), transparent 46%), linear-gradient(160deg, hsla(214, 32%, 16%, 0.98) 0%, hsla(226, 40%, 10%, 0.99) 100%)',
  },
  {
    id: 'modern',
    title: 'Современность',
    teaser: 'Знакомый мир, где каждая мелочь может изменить сюжет.',
    description:
      'Большой город, пригородные трассы, офисные кварталы и тихие спальные районы. Реалистичный сеттинг для историй о выборе, риске, расследовании и личных границах.',
    prompt:
      'Опиши стартовую сцену в современном мире: раннее утро, город просыпается, у героя есть важное решение на сегодня.',
    artwork:
      'repeating-radial-gradient(circle at 0 0, hsla(205, 24%, 58%, 0.16) 0 4px, transparent 4px 18px), radial-gradient(circle at 70% 12%, hsla(28, 24%, 58%, 0.12), transparent 40%), linear-gradient(148deg, hsla(210, 28%, 17%, 0.98) 0%, hsla(221, 34%, 11%, 0.99) 100%)',
  },
]

const headerButtonSx = {
  width: HEADER_AVATAR_SIZE,
  height: HEADER_AVATAR_SIZE,
  borderRadius: '14px',
  border: '1px solid rgba(186, 202, 214, 0.14)',
  backgroundColor: 'rgba(16, 20, 27, 0.82)',
}

const menuItemSx = {
  width: '100%',
  justifyContent: 'flex-start',
  borderRadius: '14px',
  minHeight: 52,
  px: 1.8,
  color: '#d8dee9',
  textTransform: 'none',
  fontWeight: 700,
  fontSize: '1.02rem',
  border: '1px solid rgba(186, 202, 214, 0.12)',
  background: 'linear-gradient(90deg, rgba(54, 57, 62, 0.58), rgba(31, 34, 40, 0.52))',
  '&:hover': {
    background: 'linear-gradient(90deg, rgba(68, 71, 77, 0.62), rgba(38, 42, 49, 0.58))',
  },
}

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const PENDING_PAYMENT_STORAGE_KEY = 'morius.pending.payment.id'
const FINAL_PAYMENT_STATUSES = new Set(['succeeded', 'canceled'])

const DialogTransition = forwardRef(function DialogTransition(
  props: GrowProps & {
    children: ReactElement
  },
  ref: Ref<unknown>,
) {
  return <Grow ref={ref} {...props} timeout={{ enter: 320, exit: 190 }} />
})

type AvatarPlaceholderProps = {
  fallbackLabel: string
  size?: number
}

function AvatarPlaceholder({ fallbackLabel, size = 44 }: AvatarPlaceholderProps) {
  const headSize = Math.max(13, Math.round(size * 0.27))
  const bodyWidth = Math.max(20, Math.round(size * 0.42))
  const bodyHeight = Math.max(10, Math.round(size * 0.21))

  return (
    <Box
      aria-label="Нет аватарки"
      title={fallbackLabel}
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1px solid rgba(186, 202, 214, 0.28)',
        background: 'linear-gradient(180deg, rgba(40, 49, 62, 0.86), rgba(20, 24, 31, 0.95))',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <Stack alignItems="center" spacing={0.45}>
        <Box
          sx={{
            width: headSize,
            height: headSize,
            borderRadius: '50%',
            backgroundColor: 'rgba(200, 212, 228, 0.92)',
          }}
        />
        <Box
          sx={{
            width: bodyWidth,
            height: bodyHeight,
            borderRadius: '10px 10px 7px 7px',
            backgroundColor: 'rgba(200, 212, 228, 0.92)',
          }}
        />
      </Stack>
    </Box>
  )
}

type UserAvatarProps = {
  user: AuthUser
  size?: number
}

function UserAvatar({ user, size = 44 }: UserAvatarProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const fallbackLabel = user.display_name || user.email

  if (user.avatar_url && user.avatar_url !== failedImageUrl) {
    return (
      <Box
        component="img"
        src={user.avatar_url}
        alt={fallbackLabel}
        onError={() => setFailedImageUrl(user.avatar_url)}
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: '1px solid rgba(186, 202, 214, 0.28)',
          objectFit: 'cover',
          backgroundColor: 'rgba(18, 22, 29, 0.7)',
        }}
      />
    )
  }

  return <AvatarPlaceholder fallbackLabel={fallbackLabel} size={size} />
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Некорректный формат файла'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function AuthenticatedHomePage({ user, authToken, onNavigate, onUserUpdate, onLogout }: AuthenticatedHomePageProps) {
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [topUpDialogOpen, setTopUpDialogOpen] = useState(false)
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)
  const [isAvatarSaving, setIsAvatarSaving] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [topUpPlans, setTopUpPlans] = useState<CoinTopUpPlan[]>([])
  const [hasTopUpPlansLoaded, setHasTopUpPlansLoaded] = useState(false)
  const [isTopUpPlansLoading, setIsTopUpPlansLoading] = useState(false)
  const [topUpError, setTopUpError] = useState('')
  const [activePlanPurchaseId, setActivePlanPurchaseId] = useState<string | null>(null)
  const [paymentNotice, setPaymentNotice] = useState<PaymentNotice | null>(null)
  const [dashboardView, setDashboardView] = useState<DashboardView>('welcome')
  const [quickStartTarget, setQuickStartTarget] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  const handleCloseProfileDialog = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
    setAvatarError('')
  }

  const handleCloseTopUpDialog = () => {
    setTopUpDialogOpen(false)
    setTopUpError('')
    setActivePlanPurchaseId(null)
  }

  const handleOpenTopUpDialog = () => {
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
    setTopUpError('')
    setTopUpDialogOpen(true)
  }

  const handleConfirmLogout = () => {
    setConfirmLogoutOpen(false)
    setProfileDialogOpen(false)
    setTopUpDialogOpen(false)
    onLogout()
  }

  const handleChooseAvatar = () => {
    if (isAvatarSaving) {
      return
    }
    avatarInputRef.current?.click()
  }

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setAvatarError('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }

    if (selectedFile.size > AVATAR_MAX_BYTES) {
      setAvatarError('Слишком большой файл. Максимум 2 МБ.')
      return
    }

    setAvatarError('')
    setIsAvatarSaving(true)
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      const updatedUser = await updateCurrentUserAvatar({
        token: authToken,
        avatar_url: dataUrl,
      })
      onUserUpdate(updatedUser)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить аватар'
      setAvatarError(detail)
    } finally {
      setIsAvatarSaving(false)
    }
  }

  const handleRemoveAvatar = async () => {
    if (isAvatarSaving) {
      return
    }

    setAvatarError('')
    setIsAvatarSaving(true)
    try {
      const updatedUser = await updateCurrentUserAvatar({
        token: authToken,
        avatar_url: null,
      })
      onUserUpdate(updatedUser)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось удалить аватар'
      setAvatarError(detail)
    } finally {
      setIsAvatarSaving(false)
    }
  }

  const handleStartQuickGame = useCallback(
    async (world?: PresetWorld) => {
      if (quickStartTarget) {
        return
      }

      setQuickStartTarget(world?.id ?? 'blank')
      setPaymentNotice(null)
      try {
        const game = await createStoryGame({ token: authToken })
        if (world) {
          localStorage.setItem(
            QUICK_START_WORLD_STORAGE_KEY,
            JSON.stringify({
              gameId: game.id,
              title: world.title,
              prompt: world.prompt,
            }),
          )
        } else {
          localStorage.removeItem(QUICK_START_WORLD_STORAGE_KEY)
        }

        onNavigate(`/home/${game.id}`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось создать новую игру'
        setPaymentNotice({
          severity: 'error',
          text: detail,
        })
      } finally {
        setQuickStartTarget(null)
      }
    },
    [authToken, onNavigate, quickStartTarget],
  )

  const loadTopUpPlans = useCallback(async () => {
    setIsTopUpPlansLoading(true)
    setTopUpError('')
    try {
      const plans = await getCoinTopUpPlans()
      setTopUpPlans(plans)
      setHasTopUpPlansLoaded(true)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить тарифы пополнения'
      setTopUpError(detail)
    } finally {
      setIsTopUpPlansLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!topUpDialogOpen || hasTopUpPlansLoaded || isTopUpPlansLoading) {
      return
    }
    void loadTopUpPlans()
  }, [hasTopUpPlansLoaded, isTopUpPlansLoading, loadTopUpPlans, topUpDialogOpen])

  const syncPendingPayment = useCallback(
    async (paymentId: string) => {
      try {
        const response = await syncCoinTopUpPayment({
          token: authToken,
          payment_id: paymentId,
        })

        onUserUpdate(response.user)
        if (response.status === 'succeeded') {
          localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY)
          setPaymentNotice({
            severity: 'success',
            text: `Баланс пополнен: +${response.coins} монет.`,
          })
          return
        }

        if (response.status === 'canceled') {
          localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY)
          setPaymentNotice({
            severity: 'error',
            text: 'Оплата не прошла. Можно попробовать снова.',
          })
          return
        }

        if (!FINAL_PAYMENT_STATUSES.has(response.status)) {
          setPaymentNotice({
            severity: 'info',
            text: 'Платеж обрабатывается. Монеты будут начислены после подтверждения оплаты.',
          })
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось проверить статус оплаты'
        setPaymentNotice({
          severity: 'error',
          text: detail,
        })
      }
    },
    [authToken, onUserUpdate],
  )

  useEffect(() => {
    const pendingPaymentId = localStorage.getItem(PENDING_PAYMENT_STORAGE_KEY)
    if (!pendingPaymentId) {
      return
    }
    void syncPendingPayment(pendingPaymentId)
  }, [syncPendingPayment])

  const handlePurchasePlan = async (planId: string) => {
    setTopUpError('')
    setActivePlanPurchaseId(planId)
    try {
      const response = await createCoinTopUpPayment({
        token: authToken,
        plan_id: planId,
      })
      localStorage.setItem(PENDING_PAYMENT_STORAGE_KEY, response.payment_id)
      window.location.assign(response.confirmation_url)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось создать оплату'
      setTopUpError(detail)
      setActivePlanPurchaseId(null)
    }
  }

  const profileName = user.display_name || 'Игрок'
  const isQuickStartBusy = Boolean(quickStartTarget)
  const welcomeNewsPreview = DASHBOARD_NEWS.slice(0, 3)

  return (
    <Box
      sx={{
        minHeight: '100svh',
        color: '#d6dbe4',
        background:
          'radial-gradient(circle at 68% -8%, rgba(173, 107, 44, 0.07), transparent 42%), linear-gradient(180deg, #04070d 0%, #02050a 100%)',
        position: 'relative',
        overflowX: 'hidden',
      }}
    >
      <Box
        component="header"
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 74,
          zIndex: 34,
          borderBottom: '1px solid rgba(186, 202, 214, 0.12)',
          backdropFilter: 'blur(8px)',
          background: 'linear-gradient(180deg, rgba(5, 7, 11, 0.9) 0%, rgba(5, 7, 11, 0.8) 100%)',
        }}
      />

      <Box
        sx={{
          position: 'fixed',
          top: 12,
          left: 20,
          zIndex: 35,
          display: 'flex',
          alignItems: 'center',
          gap: 1.2,
        }}
      >
        <Box component="img" src={brandLogo} alt="Morius" sx={{ width: 76, opacity: 0.96 }} />
        <IconButton
          aria-label={isPageMenuOpen ? 'Свернуть меню страниц' : 'Открыть меню страниц'}
          onClick={() => setIsPageMenuOpen((previous) => !previous)}
          sx={headerButtonSx}
        >
          <Box component="img" src={icons.home} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
        </IconButton>
      </Box>

      <Box
        sx={{
          position: 'fixed',
          top: 12,
          right: 20,
          zIndex: 45,
        }}
      >
        <Button
          variant="text"
          onClick={() => setProfileDialogOpen(true)}
          aria-label="Открыть профиль"
          sx={{
            minWidth: 0,
            width: HEADER_AVATAR_SIZE,
            height: HEADER_AVATAR_SIZE,
            p: 0,
            borderRadius: '50%',
          }}
        >
          <UserAvatar user={user} size={HEADER_AVATAR_SIZE} />
        </Button>
      </Box>

      <Box
        sx={{
          position: 'fixed',
          top: 82,
          left: 20,
          zIndex: 30,
          width: { xs: 252, md: 276 },
          borderRadius: '14px',
          border: '1px solid rgba(186, 202, 214, 0.12)',
          background:
            'linear-gradient(180deg, rgba(17, 21, 29, 0.86) 0%, rgba(13, 16, 22, 0.93) 100%), radial-gradient(circle at 40% 0%, rgba(186, 202, 214, 0.06), transparent 60%)',
          p: 1.3,
          boxShadow: '0 20px 36px rgba(0, 0, 0, 0.3)',
          transform: isPageMenuOpen ? 'translateX(0)' : 'translateX(-30px)',
          opacity: isPageMenuOpen ? 1 : 0,
          pointerEvents: isPageMenuOpen ? 'auto' : 'none',
          transition: 'transform 260ms ease, opacity 220ms ease',
        }}
      >
        <Stack spacing={1.1}>
          <Button
            sx={{
              ...menuItemSx,
              color: '#f5f8ff',
              background: 'linear-gradient(90deg, rgba(77, 84, 96, 0.62), rgba(39, 44, 53, 0.56))',
            }}
            onClick={() => onNavigate('/dashboard')}
          >
            Главная
          </Button>
          <Button sx={menuItemSx} onClick={() => onNavigate('/games')}>
            Мои игры
          </Button>
          <Button sx={menuItemSx} onClick={() => onNavigate('/games/all')}>
            Все игры
          </Button>
        </Stack>
      </Box>

      <Box
        sx={{
          pt: { xs: '82px', md: '88px' },
          pb: { xs: 5, md: 6 },
          px: { xs: 2, md: 3.2 },
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 1280, mx: 'auto' }}>
          {paymentNotice ? (
            <Alert severity={paymentNotice.severity} onClose={() => setPaymentNotice(null)} sx={{ mb: 2.2, borderRadius: '12px' }}>
              {paymentNotice.text}
            </Alert>
          ) : null}

          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.45,
              p: 0.45,
              borderRadius: '999px',
              border: '1px solid rgba(186, 202, 214, 0.14)',
              backgroundColor: 'rgba(13, 18, 26, 0.78)',
              mb: 2.1,
            }}
          >
            {DASHBOARD_TABS.map((tab) => {
              const isActive = dashboardView === tab.value
              return (
                <Button
                  key={tab.value}
                  onClick={() => setDashboardView(tab.value)}
                  sx={{
                    minHeight: 36,
                    px: 1.6,
                    borderRadius: '999px',
                    textTransform: 'none',
                    fontWeight: 700,
                    color: isActive ? '#f3f7ff' : 'rgba(198, 210, 228, 0.82)',
                    background: isActive ? 'linear-gradient(90deg, rgba(52, 63, 80, 0.9), rgba(34, 42, 56, 0.88))' : 'transparent',
                    '&:hover': {
                      background: isActive
                        ? 'linear-gradient(90deg, rgba(58, 69, 87, 0.92), rgba(38, 46, 61, 0.9))'
                        : 'rgba(186, 202, 214, 0.1)',
                    },
                  }}
                >
                  {tab.label}
                </Button>
              )
            })}
          </Box>

          {dashboardView === 'welcome' ? (
            <Box
              sx={{
                display: 'grid',
                gap: 1.4,
                gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.65fr) minmax(320px, 1fr)' },
                mb: 2.4,
              }}
            >
              <Box
                sx={{
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: '18px',
                  border: '1px solid rgba(186, 202, 214, 0.16)',
                  minHeight: { xs: 286, md: 362 },
                  p: { xs: 2, md: 2.6 },
                  display: 'flex',
                  alignItems: 'flex-end',
                  background:
                    'linear-gradient(132deg, rgba(19, 28, 38, 0.95) 0%, rgba(16, 24, 34, 0.95) 34%, rgba(27, 34, 46, 0.96) 62%, rgba(14, 19, 28, 0.98) 100%)',
                  boxShadow: '0 28px 44px rgba(0, 0, 0, 0.35)',
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    background:
                      'radial-gradient(circle at 84% 20%, rgba(233, 178, 91, 0.22), transparent 34%), repeating-linear-gradient(128deg, rgba(189, 205, 223, 0.09) 0 6px, transparent 6px 20px)',
                  }}
                />
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    right: -82,
                    top: -88,
                    width: 320,
                    height: 320,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(214, 158, 74, 0.22) 0%, rgba(214, 158, 74, 0) 68%)',
                  }}
                />

                <Stack spacing={1.05} sx={{ position: 'relative', zIndex: 1, maxWidth: { xs: '100%', lg: 560 } }}>
                  <Typography sx={{ color: 'rgba(183, 197, 216, 0.72)', letterSpacing: '0.08em', fontWeight: 700, fontSize: '0.78rem' }}>
                    WELCOME
                  </Typography>
                  <Typography sx={{ fontSize: { xs: '1.74rem', md: '2.38rem' }, fontWeight: 800, lineHeight: 1.14, color: '#e7edf8' }}>
                    Добро пожаловать, {profileName}.
                  </Typography>
                  <Typography sx={{ color: 'rgba(201, 212, 228, 0.86)', fontSize: { xs: '1rem', md: '1.06rem' }, lineHeight: 1.46 }}>
                    Начните новую историю с чистого листа или выберите готовый мир ниже для быстрого старта.
                  </Typography>
                  <Button
                    onClick={() => void handleStartQuickGame()}
                    disabled={isQuickStartBusy}
                    sx={{
                      mt: 0.6,
                      minHeight: 46,
                      maxWidth: 236,
                      borderRadius: '12px',
                      textTransform: 'none',
                      fontWeight: 800,
                      color: '#e7edf8',
                      border: '1px solid rgba(186, 202, 214, 0.22)',
                      background: 'linear-gradient(90deg, rgba(33, 45, 64, 0.94), rgba(27, 36, 52, 0.92))',
                      '&:hover': {
                        background: 'linear-gradient(90deg, rgba(39, 52, 72, 0.95), rgba(31, 41, 58, 0.93))',
                      },
                    }}
                  >
                    {quickStartTarget === 'blank' ? <CircularProgress size={18} sx={{ color: '#e7edf8' }} /> : 'Начать новую игру'}
                  </Button>
                </Stack>
              </Box>

              <Stack spacing={1.05}>
                {welcomeNewsPreview.map((item) => (
                  <Button
                    key={item.id}
                    onClick={() => setDashboardView('updates')}
                    sx={{
                      minHeight: 112,
                      borderRadius: '14px',
                      p: 1.3,
                      border: '1px solid rgba(186, 202, 214, 0.13)',
                      background: 'linear-gradient(165deg, rgba(20, 26, 36, 0.9), rgba(14, 19, 27, 0.95))',
                      textTransform: 'none',
                      textAlign: 'left',
                      alignItems: 'flex-start',
                    }}
                  >
                    <Stack spacing={0.42}>
                      <Typography sx={{ color: 'rgba(179, 194, 214, 0.72)', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                        {item.category}
                      </Typography>
                      <Typography sx={{ color: '#e3ebf8', fontSize: '1.04rem', fontWeight: 700, lineHeight: 1.2 }}>
                        {item.title}
                      </Typography>
                      <Typography
                        sx={{
                          color: 'rgba(199, 210, 226, 0.8)',
                          fontSize: '0.9rem',
                          lineHeight: 1.4,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {item.description}
                      </Typography>
                      <Typography sx={{ color: 'rgba(165, 178, 198, 0.72)', fontSize: '0.78rem' }}>{item.dateLabel}</Typography>
                    </Stack>
                  </Button>
                ))}
              </Stack>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gap: 1.2,
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
                mb: 2.4,
              }}
            >
              {DASHBOARD_NEWS.map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    borderRadius: '14px',
                    border: '1px solid rgba(186, 202, 214, 0.14)',
                    background: 'linear-gradient(166deg, rgba(20, 27, 37, 0.9), rgba(13, 18, 25, 0.95))',
                    p: 1.4,
                    minHeight: 182,
                    boxShadow: '0 14px 28px rgba(0, 0, 0, 0.24)',
                  }}
                >
                  <Stack spacing={0.5}>
                    <Typography sx={{ color: 'rgba(179, 194, 214, 0.72)', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                      {item.category}
                    </Typography>
                    <Typography sx={{ color: '#e6edf8', fontSize: '1.1rem', fontWeight: 800, lineHeight: 1.2 }}>{item.title}</Typography>
                    <Typography sx={{ color: 'rgba(198, 210, 227, 0.82)', fontSize: '0.94rem', lineHeight: 1.45 }}>
                      {item.description}
                    </Typography>
                    <Typography sx={{ mt: 0.5, color: 'rgba(165, 178, 198, 0.72)', fontSize: '0.8rem' }}>{item.dateLabel}</Typography>
                  </Stack>
                </Box>
              ))}
            </Box>
          )}

          <Stack spacing={0.45} sx={{ mb: 1.35 }}>
            <Typography sx={{ fontSize: { xs: '1.6rem', md: '1.9rem' }, fontWeight: 800, color: '#e4ebf7' }}>
              Предустановленные миры
            </Typography>
            <Typography sx={{ color: 'rgba(191, 202, 220, 0.78)', fontSize: '1.01rem' }}>
              Выберите сеттинг, получите заготовку контекста и сразу переходите к игре.
            </Typography>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gap: 1.3,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
            }}
          >
            {PRESET_WORLDS.map((world) => (
              <Button
                key={world.id}
                onClick={() => void handleStartQuickGame(world)}
                disabled={isQuickStartBusy}
                sx={{
                  p: 0,
                  borderRadius: '16px',
                  border: '1px solid rgba(186, 202, 214, 0.14)',
                  overflow: 'hidden',
                  textTransform: 'none',
                  textAlign: 'left',
                  alignItems: 'stretch',
                  background: 'linear-gradient(180deg, rgba(13, 18, 26, 0.92), rgba(10, 14, 20, 0.96))',
                  color: '#dce5f2',
                  transition: 'transform 180ms ease, border-color 180ms ease',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    borderColor: 'rgba(203, 216, 234, 0.36)',
                  },
                }}
              >
                <Box
                  sx={{
                    minHeight: { xs: 188, md: 214 },
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundImage: world.artwork,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  <Box
                    sx={{
                      mt: 'auto',
                      px: 1.2,
                      py: 1.05,
                      background:
                        'linear-gradient(180deg, rgba(6, 9, 14, 0.16) 0%, rgba(6, 9, 14, 0.9) 48%, rgba(6, 9, 14, 0.96) 100%)',
                    }}
                  >
                    <Typography sx={{ color: '#ecf2fb', fontSize: '1.28rem', fontWeight: 800, lineHeight: 1.16, mb: 0.42 }}>
                      {world.title}
                    </Typography>
                    <Typography sx={{ color: 'rgba(210, 222, 239, 0.9)', fontSize: '0.95rem', lineHeight: 1.35 }}>
                      {world.teaser}
                    </Typography>
                  </Box>
                </Box>

                <Box sx={{ px: 1.2, py: 1.05 }}>
                  <Typography sx={{ color: 'rgba(196, 208, 224, 0.86)', fontSize: '0.92rem', lineHeight: 1.42 }}>
                    {world.description}
                  </Typography>
                </Box>

                <Box
                  sx={{
                    mt: 'auto',
                    px: 1.2,
                    pb: 1.15,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Typography sx={{ color: 'rgba(178, 191, 209, 0.78)', fontSize: '0.84rem' }}>Быстрый старт</Typography>
                  <Box
                    sx={{
                      minWidth: 98,
                      minHeight: 34,
                      borderRadius: '10px',
                      border: '1px solid rgba(186, 202, 214, 0.2)',
                      backgroundColor: 'rgba(26, 34, 49, 0.88)',
                      color: '#dce5f2',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '0.92rem',
                    }}
                  >
                    {quickStartTarget === world.id ? <CircularProgress size={16} sx={{ color: '#dce5f2' }} /> : 'Играть'}
                  </Box>
                </Box>
              </Button>
            ))}
          </Box>
        </Box>
      </Box>

      <Dialog
        open={profileDialogOpen}
        onClose={handleCloseProfileDialog}
        maxWidth="xs"
        fullWidth
        TransitionComponent={DialogTransition}
        BackdropProps={{
          sx: {
            backgroundColor: 'rgba(2, 4, 8, 0.76)',
            backdropFilter: 'blur(5px)',
          },
        }}
        PaperProps={{
          sx: {
            borderRadius: '18px',
            border: '1px solid rgba(186, 202, 214, 0.16)',
            background: 'linear-gradient(180deg, rgba(16, 18, 24, 0.97) 0%, rgba(9, 11, 16, 0.98) 100%)',
            boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
            animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 1.4 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.6rem' }}>Профиль</Typography>
        </DialogTitle>

        <DialogContent sx={{ pt: 0.2 }}>
          <Stack spacing={2.2}>
            <Stack direction="row" spacing={1.8} alignItems="center">
              <UserAvatar user={user} size={84} />
              <Stack spacing={0.3} sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '1.24rem', fontWeight: 700 }}>{profileName}</Typography>
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: '0.94rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user.email}
                </Typography>
              </Stack>
            </Stack>

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleAvatarChange}
              style={{ display: 'none' }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button
                variant="outlined"
                onClick={handleChooseAvatar}
                disabled={isAvatarSaving}
                sx={{
                  minHeight: 40,
                  borderColor: 'rgba(186, 202, 214, 0.28)',
                  color: 'rgba(223, 229, 239, 0.9)',
                }}
              >
                {isAvatarSaving ? (
                  <CircularProgress size={16} sx={{ color: 'rgba(223, 229, 239, 0.9)' }} />
                ) : (
                  'Изменить аватар'
                )}
              </Button>
              <Button
                variant="text"
                onClick={handleRemoveAvatar}
                disabled={isAvatarSaving || !user.avatar_url}
                sx={{ minHeight: 40, color: 'rgba(223, 229, 239, 0.78)' }}
              >
                Удалить
              </Button>
            </Stack>

            {avatarError ? <Alert severity="error">{avatarError}</Alert> : null}

            <Box
              sx={{
                borderRadius: '12px',
                border: '1px solid rgba(186, 202, 214, 0.16)',
                backgroundColor: 'rgba(12, 16, 22, 0.62)',
                px: 1.5,
                py: 1.2,
              }}
            >
              <Stack spacing={1.3}>
                <Stack direction="row" spacing={1.1} alignItems="center">
                  <Box component="img" src={icons.coin} alt="" sx={{ width: 20, height: 20, opacity: 0.92 }} />
                  <Typography sx={{ fontSize: '0.98rem', color: 'text.secondary' }}>
                    Монеты: {user.coins.toLocaleString('ru-RU')}
                  </Typography>
                </Stack>
                <Button
                  variant="contained"
                  onClick={handleOpenTopUpDialog}
                  sx={{
                    minHeight: 40,
                    borderRadius: '10px',
                    backgroundColor: '#d9e4f2',
                    color: '#171716',
                    fontWeight: 700,
                    '&:hover': {
                      backgroundColor: '#edf4fc',
                    },
                  }}
                >
                  Пополнить баланс
                </Button>
              </Stack>
            </Box>

            <Button
              variant="outlined"
              onClick={() => setConfirmLogoutOpen(true)}
              sx={{
                minHeight: 42,
                borderColor: 'rgba(228, 120, 120, 0.44)',
                color: 'rgba(251, 190, 190, 0.92)',
                '&:hover': {
                  borderColor: 'rgba(238, 148, 148, 0.72)',
                  backgroundColor: 'rgba(214, 86, 86, 0.14)',
                },
              }}
            >
              Выйти из аккаунта
            </Button>
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.4, pt: 0.6 }}>
          <Button
            onClick={handleCloseProfileDialog}
            sx={{
              color: 'text.secondary',
            }}
          >
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={topUpDialogOpen}
        onClose={handleCloseTopUpDialog}
        maxWidth="md"
        fullWidth
        TransitionComponent={DialogTransition}
        PaperProps={{
          sx: {
            borderRadius: '18px',
            border: '1px solid rgba(186, 202, 214, 0.16)',
            background: 'linear-gradient(180deg, rgba(16, 18, 24, 0.98) 0%, rgba(9, 11, 16, 0.99) 100%)',
            boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
            animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 0.8 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.55rem' }}>Пополнение монет</Typography>
          <Typography sx={{ color: 'text.secondary', mt: 0.6 }}>
            Выберите пакет и нажмите «Купить», чтобы перейти к оплате.
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={1.8}>
            {topUpError ? <Alert severity="error">{topUpError}</Alert> : null}
            {isTopUpPlansLoading ? (
              <Stack alignItems="center" justifyContent="center" sx={{ py: 6 }}>
                <CircularProgress size={30} />
              </Stack>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gap: 1.6,
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
                }}
              >
                {topUpPlans.map((plan) => {
                  const isBuying = activePlanPurchaseId === plan.id
                  return (
                    <Box
                      key={plan.id}
                      sx={{
                        borderRadius: '14px',
                        border: '1px solid rgba(186, 202, 214, 0.18)',
                        background: 'linear-gradient(180deg, rgba(26, 31, 40, 0.9), rgba(14, 17, 23, 0.96))',
                        px: 2,
                        py: 2,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        minHeight: 210,
                      }}
                    >
                      <Stack spacing={0.7}>
                        <Typography sx={{ fontSize: '1.05rem', fontWeight: 700 }}>{plan.title}</Typography>
                        <Typography sx={{ fontSize: '1.6rem', fontWeight: 800, color: '#d9e4f2' }}>
                          {plan.price_rub} ₽
                        </Typography>
                        <Typography sx={{ fontSize: '0.95rem', color: 'text.secondary' }}>
                          {plan.description}
                        </Typography>
                        <Typography sx={{ fontSize: '0.95rem', color: 'text.secondary' }}>
                          +{plan.coins.toLocaleString('ru-RU')} монет
                        </Typography>
                      </Stack>
                      <Button
                        variant="contained"
                        disabled={Boolean(activePlanPurchaseId)}
                        onClick={() => void handlePurchasePlan(plan.id)}
                        sx={{
                          mt: 2,
                          minHeight: 40,
                          borderRadius: '10px',
                          backgroundColor: '#d9e4f2',
                          color: '#171716',
                          fontWeight: 700,
                          '&:hover': { backgroundColor: '#edf4fc' },
                        }}
                      >
                        {isBuying ? <CircularProgress size={16} sx={{ color: '#171716' }} /> : 'Купить'}
                      </Button>
                    </Box>
                  )
                })}
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button onClick={handleCloseTopUpDialog} sx={{ color: 'text.secondary' }}>
            Назад
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={confirmLogoutOpen}
        onClose={() => setConfirmLogoutOpen(false)}
        maxWidth="xs"
        fullWidth
        TransitionComponent={DialogTransition}
        PaperProps={{
          sx: {
            borderRadius: '16px',
            border: '1px solid rgba(186, 202, 214, 0.16)',
            background: 'linear-gradient(180deg, rgba(16, 18, 24, 0.98) 0%, rgba(10, 12, 18, 0.99) 100%)',
            animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Подтвердите выход</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'text.secondary' }}>
            Вы точно хотите выйти из аккаунта? После выхода вы вернетесь на страницу превью.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={() => setConfirmLogoutOpen(false)} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={handleConfirmLogout}
            sx={{
              backgroundColor: '#d9e4f2',
              color: '#171716',
              '&:hover': { backgroundColor: '#edf4fc' },
            }}
          >
            Выйти
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default AuthenticatedHomePage
