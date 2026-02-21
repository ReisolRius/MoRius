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
import { icons } from '../assets'
import AppHeader from '../components/AppHeader'
import { OPEN_CHARACTER_MANAGER_FLAG_KEY, QUICK_START_WORLD_STORAGE_KEY } from '../constants/storageKeys'
import {
  createCoinTopUpPayment,
  getCoinTopUpPlans,
  syncCoinTopUpPayment,
  updateCurrentUserAvatar,
  type CoinTopUpPlan,
} from '../services/authApi'
import { createStoryGame } from '../services/storyApi'
import { moriusThemeTokens } from '../theme'
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
  artwork: string
}

const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const APP_PAGE_BACKGROUND = 'var(--morius-app-bg)'
const APP_CARD_BACKGROUND = 'var(--morius-card-bg)'
const APP_BORDER_COLOR = 'var(--morius-card-border)'
const APP_TEXT_PRIMARY = 'var(--morius-text-primary)'
const APP_TEXT_SECONDARY = 'var(--morius-text-secondary)'
const APP_BUTTON_HOVER = 'var(--morius-button-hover)'
const APP_BUTTON_ACTIVE = 'var(--morius-button-active)'
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
    artwork:
      'repeating-linear-gradient(24deg, hsla(42, 30%, 55%, 0.16) 0 12px, transparent 12px 28px), radial-gradient(circle at 78% 22%, hsla(40, 44%, 62%, 0.18), transparent 42%), linear-gradient(152deg, hsla(208, 34%, 17%, 0.98) 0%, hsla(219, 38%, 11%, 0.99) 100%)',
  },
  {
    id: 'cyberpunk',
    title: 'Киберпанк',
    teaser: 'Неоновые кварталы, корпорации и хаос нижнего города.',
    description:
      'Мегаполис под кислотным дождём. В небе висят рекламные дроны, а на уровне улиц власть делят синдикаты, уличные сети и корпоративные отделы безопасности.',
    artwork:
      'repeating-linear-gradient(118deg, hsla(195, 34%, 58%, 0.16) 0 10px, transparent 10px 24px), radial-gradient(circle at 16% 80%, hsla(207, 42%, 60%, 0.17), transparent 46%), linear-gradient(160deg, hsla(214, 32%, 16%, 0.98) 0%, hsla(226, 40%, 10%, 0.99) 100%)',
  },
  {
    id: 'modern',
    title: 'Современность',
    teaser: 'Знакомый мир, где каждая мелочь может изменить сюжет.',
    description:
      'Большой город, пригородные трассы, офисные кварталы и тихие спальные районы. Реалистичный сеттинг для историй о выборе, риске, расследовании и личных границах.',
    artwork:
      'repeating-radial-gradient(circle at 0 0, hsla(205, 24%, 58%, 0.16) 0 4px, transparent 4px 18px), radial-gradient(circle at 70% 12%, hsla(28, 24%, 58%, 0.12), transparent 40%), linear-gradient(148deg, hsla(210, 28%, 17%, 0.98) 0%, hsla(221, 34%, 11%, 0.99) 100%)',
  },
]

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
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(true)
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
  const [quickStartTarget, setQuickStartTarget] = useState<string | null>(null)
  const [selectedNewsItem, setSelectedNewsItem] = useState<DashboardNewsItem | null>(null)
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

  const handleOpenCharacterManager = () => {
    localStorage.setItem(OPEN_CHARACTER_MANAGER_FLAG_KEY, '1')
    setProfileDialogOpen(false)
    setConfirmLogoutOpen(false)
    setTopUpDialogOpen(false)
    onNavigate('/home')
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
              description: world.description,
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

  const handleOpenNewsDetails = (item: DashboardNewsItem) => {
    setSelectedNewsItem(item)
  }

  const handleCloseNewsDetails = () => {
    setSelectedNewsItem(null)
  }

  const profileName = user.display_name || 'Игрок'
  const isQuickStartBusy = Boolean(quickStartTarget)
  const dashboardView = 'welcome' as const

  return (
    <Box
      className="morius-app-shell"
      sx={{
        minHeight: '100svh',
        color: APP_TEXT_PRIMARY,
        background: APP_PAGE_BACKGROUND,
        position: 'relative',
        overflowX: 'hidden',
      }}
    >
      <AppHeader
        isPageMenuOpen={isPageMenuOpen}
        onTogglePageMenu={() => setIsPageMenuOpen((previous) => !previous)}
        menuItems={[
          { key: 'dashboard', label: 'Главная', isActive: true, onClick: () => onNavigate('/dashboard') },
          { key: 'games-my', label: 'Мои игры', onClick: () => onNavigate('/games') },
          { key: 'games-all', label: 'Все игры', onClick: () => onNavigate('/games/all') },
        ]}
        pageMenuLabels={{
          expanded: 'Свернуть меню страниц',
          collapsed: 'Открыть меню страниц',
        }}
        isRightPanelOpen={isHeaderActionsOpen}
        onToggleRightPanel={() => setIsHeaderActionsOpen((previous) => !previous)}
        rightToggleLabels={{
          expanded: 'Скрыть кнопки шапки',
          collapsed: 'Показать кнопки шапки',
        }}
        rightActions={
          <Stack direction="row" spacing={1.2}>
            <IconButton
              aria-label="Поддержка"
              onClick={(event) => event.preventDefault()}
              sx={{
                width: 44,
                height: 44,
                borderRadius: '14px',
                border: `1px solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                transition: 'background-color 180ms ease',
                '&:hover': {
                  backgroundColor: APP_BUTTON_HOVER,
                },
              }}
            >
              <Box component="img" src={icons.help} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
            </IconButton>
            <IconButton
              aria-label="Оформление"
              onClick={(event) => event.preventDefault()}
              sx={{
                width: 44,
                height: 44,
                borderRadius: '14px',
                border: `1px solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
                transition: 'background-color 180ms ease',
                '&:hover': {
                  backgroundColor: APP_BUTTON_HOVER,
                },
              }}
            >
              <Box component="img" src={icons.theme} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
            </IconButton>
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
          </Stack>
        }
      />

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
                  border: `1px solid ${APP_BORDER_COLOR}`,
                  minHeight: { xs: 286, md: 362 },
                  p: { xs: 2, md: 2.6 },
                  display: 'flex',
                  alignItems: 'flex-end',
                  background: APP_CARD_BACKGROUND,
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
                    inset: 0,
                    background:
                      'linear-gradient(180deg, rgba(4, 7, 11, 0.44) 0%, rgba(4, 7, 11, 0.58) 54%, rgba(4, 7, 11, 0.74) 100%)',
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
                  <Typography sx={{ color: APP_TEXT_SECONDARY, letterSpacing: '0.08em', fontWeight: 700, fontSize: '0.78rem' }}>
                    WELCOME
                  </Typography>
                  <Typography sx={{ fontSize: { xs: '1.74rem', md: '2.38rem' }, fontWeight: 800, lineHeight: 1.14, color: APP_TEXT_PRIMARY }}>
                    Добро пожаловать, {profileName}.
                  </Typography>
                  <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: { xs: '1rem', md: '1.06rem' }, lineHeight: 1.46 }}>
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
                      color: APP_TEXT_PRIMARY,
                      border: `1px solid ${APP_BORDER_COLOR}`,
                      backgroundColor: APP_BUTTON_ACTIVE,
                      '&:hover': {
                        backgroundColor: APP_BUTTON_HOVER,
                      },
                    }}
                  >
                    {quickStartTarget === 'blank' ? <CircularProgress size={18} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Начать новую игру'}
                  </Button>
                </Stack>
              </Box>

              <Stack spacing={1.05}>
                {DASHBOARD_NEWS.map((item) => (
                  <Button
                    key={item.id}
                    onClick={() => handleOpenNewsDetails(item)}
                    sx={{
                      minHeight: 112,
                      borderRadius: '14px',
                      p: 1.3,
                      border: `1px solid ${APP_BORDER_COLOR}`,
                      background: APP_CARD_BACKGROUND,
                      textTransform: 'none',
                      textAlign: 'left',
                      alignItems: 'flex-start',
                    }}
                  >
                    <Stack spacing={0.42}>
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                        {item.category}
                      </Typography>
                      <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.04rem', fontWeight: 700, lineHeight: 1.2 }}>
                        {item.title}
                      </Typography>
                      <Typography
                        sx={{
                          color: APP_TEXT_SECONDARY,
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
                      <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.78rem' }}>{item.dateLabel}</Typography>
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
            <Typography sx={{ fontSize: { xs: '1.6rem', md: '1.9rem' }, fontWeight: 800, color: APP_TEXT_PRIMARY }}>
              Предустановленные миры
            </Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1.01rem' }}>
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
                  border: `1px solid ${APP_BORDER_COLOR}`,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  textTransform: 'none',
                  textAlign: 'left',
                  alignItems: 'stretch',
                  background: APP_CARD_BACKGROUND,
                  color: APP_TEXT_PRIMARY,
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
                        'linear-gradient(180deg, rgba(6, 9, 14, 0.26) 0%, rgba(6, 9, 14, 0.94) 48%, rgba(6, 9, 14, 0.98) 100%)',
                    }}
                  >
                    <Typography sx={{ color: APP_TEXT_PRIMARY, fontSize: '1.28rem', fontWeight: 800, lineHeight: 1.16, mb: 0.42 }}>
                      {world.title}
                    </Typography>
                  </Box>
                </Box>

                <Box sx={{ px: 1.2, py: 1.05 }}>
                  <Typography
                    sx={{
                      color: APP_TEXT_SECONDARY,
                      fontSize: '0.92rem',
                      lineHeight: 1.42,
                      display: '-webkit-box',
                      WebkitLineClamp: 4,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {world.description}
                  </Typography>
                </Box>

                {quickStartTarget === world.id ? (
                  <Box sx={{ mt: 'auto', px: 1.2, pb: 1.15 }}>
                    <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} />
                  </Box>
                ) : null}
              </Button>
            ))}
          </Box>
        </Box>
      </Box>

      <Dialog
        open={selectedNewsItem !== null}
        onClose={handleCloseNewsDetails}
        maxWidth="sm"
        fullWidth
        TransitionComponent={DialogTransition}
        PaperProps={{
          sx: {
            borderRadius: '18px',
            border: `1px solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
            boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
            animation: 'morius-dialog-pop 330ms cubic-bezier(0.22, 1, 0.36, 1)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 0.8 }}>
          <Stack spacing={0.4}>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.82rem', fontWeight: 700, letterSpacing: '0.04em' }}>
              {selectedNewsItem?.category}
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '1.6rem', lineHeight: 1.2 }}>{selectedNewsItem?.title}</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.8 }}>
          <Stack spacing={1.2}>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '1rem', lineHeight: 1.6 }}>
              {selectedNewsItem?.description}
            </Typography>
            <Typography sx={{ color: APP_TEXT_SECONDARY, fontSize: '0.88rem' }}>{selectedNewsItem?.dateLabel}</Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={handleCloseNewsDetails} sx={{ color: APP_TEXT_SECONDARY }}>
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

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
            border: `1px solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
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
                  borderColor: APP_BORDER_COLOR,
                  color: APP_TEXT_PRIMARY,
                }}
              >
                {isAvatarSaving ? (
                  <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} />
                ) : (
                  'Изменить аватар'
                )}
              </Button>
              <Button
                variant="text"
                onClick={handleRemoveAvatar}
                disabled={isAvatarSaving || !user.avatar_url}
                sx={{ minHeight: 40, color: APP_TEXT_SECONDARY }}
              >
                Удалить
              </Button>
            </Stack>

            {avatarError ? <Alert severity="error">{avatarError}</Alert> : null}

            <Box
              sx={{
                borderRadius: '12px',
                border: `1px solid ${APP_BORDER_COLOR}`,
                backgroundColor: APP_CARD_BACKGROUND,
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
                    border: `1px solid ${APP_BORDER_COLOR}`,
                    backgroundColor: APP_BUTTON_ACTIVE,
                    color: APP_TEXT_PRIMARY,
                    fontWeight: 700,
                    '&:hover': {
                      backgroundColor: APP_BUTTON_HOVER,
                    },
                  }}
                >
                  Пополнить баланс
                </Button>
              </Stack>
            </Box>

            <Button
              variant="outlined"
              onClick={handleOpenCharacterManager}
              sx={{
                minHeight: 42,
                borderColor: 'rgba(186, 202, 214, 0.38)',
                color: APP_TEXT_PRIMARY,
                '&:hover': {
                  borderColor: 'rgba(206, 220, 237, 0.54)',
                  backgroundColor: 'rgba(34, 45, 62, 0.32)',
                },
              }}
            >
              Мои персонажи
            </Button>

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
            border: `1px solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
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
                        border: `1px solid ${APP_BORDER_COLOR}`,
                        background: APP_CARD_BACKGROUND,
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
                        <Typography sx={{ fontSize: '1.6rem', fontWeight: 800, color: APP_TEXT_PRIMARY }}>
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
                          border: `1px solid ${APP_BORDER_COLOR}`,
                          backgroundColor: APP_BUTTON_ACTIVE,
                          color: APP_TEXT_PRIMARY,
                          fontWeight: 700,
                          '&:hover': { backgroundColor: APP_BUTTON_HOVER },
                        }}
                      >
                        {isBuying ? <CircularProgress size={16} sx={{ color: APP_TEXT_PRIMARY }} /> : 'Купить'}
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
            border: `1px solid ${APP_BORDER_COLOR}`,
            background: APP_CARD_BACKGROUND,
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
              border: `1px solid ${APP_BORDER_COLOR}`,
              backgroundColor: APP_BUTTON_ACTIVE,
              color: APP_TEXT_PRIMARY,
              '&:hover': { backgroundColor: APP_BUTTON_HOVER },
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
