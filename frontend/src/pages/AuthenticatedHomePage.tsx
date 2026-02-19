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
  Container,
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
import type { AuthUser } from '../types/auth'

type AuthenticatedHomePageProps = {
  user: AuthUser
  authToken: string
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
}

type PaymentNotice = {
  severity: AlertColor
  text: string
}

const scenarios = [
  { id: 'scenario-1', label: 'КНОПКА ЧИНБАЗЕС' },
  { id: 'scenario-2', label: 'КНОПКА ЧИНБАЗЕС' },
  { id: 'scenario-3', label: 'КНОПКА ЧИНБАЗЕС' },
]

const headerButtonSx = {
  width: 48,
  height: 48,
  borderRadius: '14px',
  border: '1px solid rgba(186, 202, 214, 0.12)',
  backgroundColor: 'rgba(18, 22, 29, 0.52)',
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

function AvatarPlaceholder({ fallbackLabel, size = 48 }: AvatarPlaceholderProps) {
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

function UserAvatar({ user, size = 48 }: UserAvatarProps) {
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

function AuthenticatedHomePage({ user, authToken, onUserUpdate, onLogout }: AuthenticatedHomePageProps) {
  const [headerPanelOpen, setHeaderPanelOpen] = useState(true)
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

  return (
    <Box
      sx={{
        minHeight: '100svh',
        backgroundColor: '#05070b',
        color: 'text.primary',
      }}
    >
      <Box component="header" sx={{ position: 'relative', px: { xs: 2, md: 3 }, pt: { xs: 2, md: 2.6 } }}>
        <Box component="img" src={brandLogo} alt="Morius" sx={{ width: { xs: 90, md: 102 } }} />

        <Box sx={{ position: 'absolute', right: { xs: 10, md: 18 }, top: { xs: 10, md: 14 }, zIndex: 2 }}>
          <Stack
            direction="row"
            alignItems="center"
            spacing={1.3}
            sx={{
              transform: headerPanelOpen ? 'translateX(0)' : 'translateX(calc(100% - 48px))',
              transition: 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1)',
              willChange: 'transform',
            }}
          >
            <IconButton
              aria-label={headerPanelOpen ? 'Свернуть блок управления' : 'Развернуть блок управления'}
              onClick={() => setHeaderPanelOpen((prev) => !prev)}
              sx={headerButtonSx}
            >
              <Box
                component="img"
                src={icons.back}
                alt=""
                sx={{
                  width: 20,
                  height: 20,
                  transform: headerPanelOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 250ms ease',
                  opacity: 0.86,
                }}
              />
            </IconButton>

            <Stack
              direction="row"
              alignItems="center"
              spacing={1.3}
              sx={{
                opacity: headerPanelOpen ? 1 : 0,
                pointerEvents: headerPanelOpen ? 'auto' : 'none',
                transition: 'opacity 180ms ease',
              }}
            >
              <IconButton aria-label="Быстрый переход" sx={headerButtonSx}>
                <Box component="img" src={icons.send} alt="" sx={{ width: 19, height: 19, opacity: 0.85 }} />
              </IconButton>
              <IconButton aria-label="Настройки" sx={headerButtonSx}>
                <Box component="img" src={icons.settings} alt="" sx={{ width: 20, height: 20, opacity: 0.85 }} />
              </IconButton>
              <IconButton aria-label="Монеты" sx={headerButtonSx}>
                <Box component="img" src={icons.coin} alt="" sx={{ width: 20, height: 20, opacity: 0.85 }} />
              </IconButton>

              <Button
                variant="text"
                onClick={() => setProfileDialogOpen(true)}
                aria-label="Открыть профиль"
                sx={{
                  minWidth: 0,
                  width: 48,
                  height: 48,
                  p: 0,
                  borderRadius: '50%',
                }}
              >
                <UserAvatar user={user} />
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Box>

      <Container maxWidth="xl" sx={{ pt: { xs: 8, md: 11 }, pb: { xs: 6, md: 10 } }}>
        {paymentNotice ? (
          <Alert
            severity={paymentNotice.severity}
            onClose={() => setPaymentNotice(null)}
            sx={{ mb: 2.5, maxWidth: 760 }}
          >
            {paymentNotice.text}
          </Alert>
        ) : null}

        <Box
          sx={{
            display: 'grid',
            gap: { xs: 2.2, md: 2.7 },
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
          }}
        >
          {scenarios.map((scenario) => (
            <Box
              key={scenario.id}
              sx={{
                minHeight: { xs: 430, md: 560 },
                borderRadius: '16px',
                border: '1px solid rgba(186, 202, 214, 0.08)',
                background: 'linear-gradient(180deg, rgba(24, 28, 34, 0.88), rgba(18, 21, 27, 0.96))',
                p: 1.5,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 26px 44px rgba(0, 0, 0, 0.36)',
              }}
            >
              <Box
                aria-hidden
                sx={{
                  height: { xs: 270, md: 410 },
                  borderRadius: '12px',
                  border: '1px solid rgba(205, 214, 226, 0.12)',
                  background:
                    'linear-gradient(180deg, rgba(248, 223, 156, 0.98) 0%, rgba(248, 197, 96, 0.95) 28%, rgba(151, 128, 87, 0.78) 45%, rgba(68, 101, 42, 0.92) 62%, rgba(55, 84, 34, 0.98) 100%), radial-gradient(circle at 78% 30%, rgba(255, 188, 85, 0.35), transparent 32%)',
                  boxShadow: 'inset 0 0 36px rgba(0, 0, 0, 0.22)',
                }}
              />

              <Button
                variant="contained"
                sx={{
                  mt: 2.2,
                  minHeight: 46,
                  borderRadius: '12px',
                  fontSize: { xs: '1.8rem', md: '2.05rem' },
                  fontWeight: 800,
                  backgroundColor: '#b7c6d5',
                  color: '#20252d',
                  '&:hover': {
                    backgroundColor: '#c5d4e2',
                  },
                }}
              >
                {scenario.label}
              </Button>
            </Box>
          ))}
        </Box>
      </Container>

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
