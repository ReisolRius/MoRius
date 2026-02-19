import { forwardRef, useEffect, useRef, useState, type FormEvent, type ReactElement, type Ref } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Grow,
  IconButton,
  Stack,
  TextField,
  Typography,
  type GrowProps,
} from '@mui/material'
import { GOOGLE_CLIENT_ID, IS_GOOGLE_AUTH_CONFIGURED } from '../config/env'
import {
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
  verifyEmailRegistration,
} from '../services/authApi'
import type { AuthResponse } from '../types/auth'

export type AuthMode = 'login' | 'register'
type RegisterStep = 'credentials' | 'verify'

type AuthDialogProps = {
  open: boolean
  initialMode: AuthMode
  onClose: () => void
  onAuthSuccess: (payload: AuthResponse) => void
}

const RESEND_COOLDOWN_SECONDS = 60
const RESEND_COOLDOWN_REGEX = /please wait\s+(\d+)\s+seconds?/i

function formatResendCooldown(seconds: number): string {
  const safeSeconds = Math.max(seconds, 0)
  const minutes = Math.floor(safeSeconds / 60)
  const secondsPart = String(safeSeconds % 60).padStart(2, '0')
  return `${minutes}:${secondsPart}`
}

function extractResendCooldownSeconds(detail: string): number | null {
  const match = detail.match(RESEND_COOLDOWN_REGEX)
  if (!match) {
    return null
  }

  const parsed = Number.parseInt(match[1], 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

const formFieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '12px',
    backgroundColor: 'rgba(10, 14, 20, 0.66)',
    '& fieldset': {
      borderColor: 'rgba(186, 202, 214, 0.22)',
    },
    '&:hover fieldset': {
      borderColor: 'rgba(186, 202, 214, 0.38)',
    },
    '&.Mui-focused fieldset': {
      borderColor: 'rgba(186, 202, 214, 0.62)',
    },
  },
  '& .MuiInputLabel-root': {
    color: 'rgba(223, 229, 239, 0.72)',
  },
  '& .MuiInputBase-input': {
    color: '#edf2f9',
  },
}

const AuthDialogTransition = forwardRef(function AuthDialogTransition(
  props: GrowProps & {
    children: ReactElement
  },
  ref: Ref<unknown>,
) {
  return <Grow ref={ref} {...props} timeout={{ enter: 340, exit: 200 }} />
})

function AuthDialog({ open, initialMode, onClose, onAuthSuccess }: AuthDialogProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [registerStep, setRegisterStep] = useState<RegisterStep>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [infoMessage, setInfoMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false)
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0)
  const [googleButtonWidth, setGoogleButtonWidth] = useState(320)
  const googleButtonContainerRef = useRef<HTMLDivElement | null>(null)

  const isRegisterMode = mode === 'register'
  const isVerificationStep = isRegisterMode && registerStep === 'verify'
  const hasGoogleClientId = IS_GOOGLE_AUTH_CONFIGURED && Boolean(GOOGLE_CLIENT_ID)

  const startResendCooldown = (seconds = RESEND_COOLDOWN_SECONDS) => {
    setResendCooldownSeconds(Math.max(seconds, 0))
  }

  useEffect(() => {
    if (!open) {
      return
    }
    setMode(initialMode)
    setRegisterStep('credentials')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setVerificationCode('')
    setErrorMessage('')
    setInfoMessage('')
    setIsSubmitting(false)
    setIsGoogleSubmitting(false)
    setResendCooldownSeconds(0)
  }, [initialMode, open])

  useEffect(() => {
    if (resendCooldownSeconds <= 0) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setResendCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => window.clearTimeout(timeoutId)
  }, [resendCooldownSeconds])

  useEffect(() => {
    if (!hasGoogleClientId || !open) {
      return
    }

    const node = googleButtonContainerRef.current
    if (!node) {
      return
    }

    const updateWidth = () => {
      const nextWidth = Math.max(220, Math.floor(node.getBoundingClientRect().width))
      setGoogleButtonWidth(nextWidth)
    }

    updateWidth()

    const observer = new ResizeObserver(() => updateWidth())
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasGoogleClientId, open])

  const handleSwitchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setRegisterStep('credentials')
    setVerificationCode('')
    setErrorMessage('')
    setInfoMessage('')
    setResendCooldownSeconds(0)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage('')
    setInfoMessage('')

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setErrorMessage('Укажите email.')
      return
    }

    if (!isRegisterMode) {
      if (!password) {
        setErrorMessage('Укажите пароль.')
        return
      }

      setIsSubmitting(true)
      try {
        const authResult = await loginWithEmail({ email: normalizedEmail, password })
        onAuthSuccess(authResult)
        onClose()
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Ошибка авторизации'
        setErrorMessage(detail)
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    if (registerStep === 'credentials') {
      if (!password) {
        setErrorMessage('Укажите пароль.')
        return
      }

      if (password.length < 8) {
        setErrorMessage('Пароль должен быть не короче 8 символов.')
        return
      }

      if (password !== confirmPassword) {
        setErrorMessage('Пароли не совпадают.')
        return
      }

      setIsSubmitting(true)
      try {
        const response = await registerWithEmail({ email: normalizedEmail, password })
        setRegisterStep('verify')
        startResendCooldown()
        setInfoMessage(response.message || 'Код подтверждения отправлен на вашу почту.')
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Ошибка регистрации'
        const cooldownFromError = extractResendCooldownSeconds(detail)
        if (cooldownFromError) {
          setRegisterStep('verify')
          startResendCooldown(cooldownFromError)
          setInfoMessage(`Повторная отправка будет доступна через ${formatResendCooldown(cooldownFromError)}.`)
        } else {
          setErrorMessage(detail)
        }
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    const cleanedCode = verificationCode.trim()
    if (!/^\d{6}$/.test(cleanedCode)) {
      setErrorMessage('Введите 6-значный код из письма.')
      return
    }

    setIsSubmitting(true)
    try {
      const authResult = await verifyEmailRegistration({ email: normalizedEmail, code: cleanedCode })
      onAuthSuccess(authResult)
      onClose()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Ошибка подтверждения email'
      setErrorMessage(detail)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResendCode = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setErrorMessage('Укажите email.')
      return
    }

    if (!password) {
      setErrorMessage('Укажите пароль, чтобы отправить код повторно.')
      return
    }

    if (resendCooldownSeconds > 0) {
      setInfoMessage(`Повторная отправка будет доступна через ${formatResendCooldown(resendCooldownSeconds)}.`)
      return
    }

    setErrorMessage('')
    setInfoMessage('')
    setIsSubmitting(true)
    try {
      const response = await registerWithEmail({ email: normalizedEmail, password })
      startResendCooldown()
      setInfoMessage(response.message || 'Код отправлен повторно.')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось отправить код повторно'
      const cooldownFromError = extractResendCooldownSeconds(detail)
      if (cooldownFromError) {
        startResendCooldown(cooldownFromError)
        setInfoMessage(`Повторная отправка будет доступна через ${formatResendCooldown(cooldownFromError)}.`)
      } else {
        setErrorMessage(detail)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGoogleSuccess = async (credential: string | undefined) => {
    if (!credential) {
      setErrorMessage('Не удалось получить токен Google.')
      return
    }

    setErrorMessage('')
    setInfoMessage('')
    setIsGoogleSubmitting(true)
    try {
      const authResult = await loginWithGoogle(credential)
      onAuthSuccess(authResult)
      onClose()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Ошибка входа через Google'
      setErrorMessage(detail)
    } finally {
      setIsGoogleSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      TransitionComponent={AuthDialogTransition}
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
          background:
            'linear-gradient(180deg, rgba(16, 18, 24, 0.97) 0%, rgba(9, 11, 16, 0.98) 100%)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          overflow: 'hidden',
          animation: 'morius-dialog-pop 340ms cubic-bezier(0.22, 1, 0.36, 1)',
        },
      }}
    >
      <DialogTitle
        sx={{
          px: 2.4,
          pt: 2.2,
          pb: 1.2,
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography sx={{ fontWeight: 700, fontSize: '1.68rem' }}>
            {isRegisterMode ? 'Регистрация' : 'Вход'}
          </Typography>
          <IconButton
            aria-label="Закрыть"
            onClick={onClose}
            sx={{
              width: 34,
              height: 34,
              borderRadius: '10px',
              border: '1px solid rgba(186, 202, 214, 0.14)',
              color: 'rgba(223, 229, 239, 0.84)',
              fontSize: '1.35rem',
              lineHeight: 1,
            }}
          >
            x
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ px: 2.4, pb: 2.4, pt: 0.5 }}>
        <Stack spacing={1.8}>
          <Stack
            direction="row"
            spacing={0.6}
            sx={{
              p: 0.6,
              borderRadius: '12px',
              border: '1px solid rgba(186, 202, 214, 0.12)',
              backgroundColor: 'rgba(12, 16, 22, 0.64)',
            }}
          >
            <Button
              fullWidth
              onClick={() => handleSwitchMode('login')}
              variant={mode === 'login' ? 'contained' : 'text'}
              sx={{
                minHeight: 40,
                color: mode === 'login' ? '#171716' : 'rgba(223, 229, 239, 0.82)',
                backgroundColor: mode === 'login' ? '#d9e4f2' : 'transparent',
                '&:hover': {
                  backgroundColor: mode === 'login' ? '#edf4fc' : 'rgba(186, 202, 214, 0.08)',
                },
              }}
            >
              Войти
            </Button>
            <Button
              fullWidth
              onClick={() => handleSwitchMode('register')}
              variant={mode === 'register' ? 'contained' : 'text'}
              sx={{
                minHeight: 40,
                color: mode === 'register' ? '#171716' : 'rgba(223, 229, 239, 0.82)',
                backgroundColor: mode === 'register' ? '#d9e4f2' : 'transparent',
                '&:hover': {
                  backgroundColor: mode === 'register' ? '#edf4fc' : 'rgba(186, 202, 214, 0.08)',
                },
              }}
            >
              Создать
            </Button>
          </Stack>

          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={1.8}>
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                fullWidth
                disabled={isVerificationStep}
                sx={formFieldSx}
              />

              {isVerificationStep ? (
                <TextField
                  label="Код подтверждения"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value)}
                  fullWidth
                  autoFocus
                  sx={formFieldSx}
                  inputProps={{ inputMode: 'numeric', maxLength: 6 }}
                />
              ) : (
                <>
                  <TextField
                    label="Пароль"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    fullWidth
                    sx={formFieldSx}
                  />
                  {isRegisterMode ? (
                    <TextField
                      label="Повторите пароль"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      fullWidth
                      sx={formFieldSx}
                    />
                  ) : null}
                </>
              )}

              {infoMessage ? <Alert severity="info">{infoMessage}</Alert> : null}
              {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

              {isVerificationStep ? (
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="text"
                    fullWidth
                    onClick={handleResendCode}
                    disabled={isSubmitting || isGoogleSubmitting || resendCooldownSeconds > 0}
                    sx={{ minHeight: 42, color: 'rgba(223, 229, 239, 0.84)' }}
                  >
                    {resendCooldownSeconds > 0
                      ? `Отправить снова через ${formatResendCooldown(resendCooldownSeconds)}`
                      : 'Отправить код снова'}
                  </Button>
                  <Button
                    variant="text"
                    fullWidth
                    onClick={() => {
                      setRegisterStep('credentials')
                      setVerificationCode('')
                      setErrorMessage('')
                      setInfoMessage('')
                      setResendCooldownSeconds(0)
                    }}
                    disabled={isSubmitting || isGoogleSubmitting}
                    sx={{ minHeight: 42, color: 'rgba(223, 229, 239, 0.84)' }}
                  >
                    Изменить данные
                  </Button>
                </Stack>
              ) : null}

              <Button
                variant="contained"
                fullWidth
                type="submit"
                disabled={isSubmitting || isGoogleSubmitting}
                sx={{
                  minHeight: 44,
                  backgroundColor: '#d9e4f2',
                  color: '#171716',
                  '&:hover': { backgroundColor: '#edf4fc' },
                  '&:disabled': { opacity: 0.66 },
                }}
              >
                {isSubmitting ? (
                  <CircularProgress size={20} sx={{ color: '#171716' }} />
                ) : isVerificationStep ? (
                  'Подтвердить email'
                ) : isRegisterMode ? (
                  'Зарегистрироваться'
                ) : (
                  'Войти'
                )}
              </Button>
            </Stack>
          </Box>

          {!isVerificationStep ? (
            <>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Divider sx={{ flex: 1, borderColor: 'rgba(186, 202, 214, 0.2)' }} />
                <Typography sx={{ color: 'rgba(223, 229, 239, 0.66)', fontSize: '0.86rem' }}>или</Typography>
                <Divider sx={{ flex: 1, borderColor: 'rgba(186, 202, 214, 0.2)' }} />
              </Stack>

              {hasGoogleClientId ? (
                <Stack spacing={1}>
                  <Box
                    ref={googleButtonContainerRef}
                    sx={{
                      display: 'flex',
                      justifyContent: 'center',
                      width: '100%',
                    }}
                  >
                    <GoogleLogin
                      onSuccess={(credentialResponse) => handleGoogleSuccess(credentialResponse.credential)}
                      onError={() => setErrorMessage('Не удалось войти через Google.')}
                      text={isRegisterMode ? 'signup_with' : 'signin_with'}
                      shape="pill"
                      theme="filled_black"
                      width={String(googleButtonWidth)}
                    />
                  </Box>
                  {isGoogleSubmitting ? (
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
                      <CircularProgress size={16} />
                      <Typography sx={{ fontSize: '0.84rem', color: 'rgba(223, 229, 239, 0.74)' }}>
                        Проверяем Google аккаунт...
                      </Typography>
                    </Stack>
                  ) : null}
                </Stack>
              ) : (
                <Alert severity="warning">
                  Google вход отключен. Проверьте `VITE_GOOGLE_CLIENT_ID` во `frontend/.env` и
                  `GOOGLE_CLIENT_ID` в `backend/.env`.
                </Alert>
              )}

              <Typography sx={{ textAlign: 'center', color: 'rgba(223, 229, 239, 0.72)', fontSize: '0.86rem' }}>
                {isRegisterMode ? 'Уже есть аккаунт?' : 'Еще нет аккаунта?'}{' '}
                <Box
                  component="button"
                  onClick={() => handleSwitchMode(isRegisterMode ? 'login' : 'register')}
                  sx={{
                    m: 0,
                    p: 0,
                    border: 'none',
                    background: 'transparent',
                    color: '#d9e4f2',
                    font: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  {isRegisterMode ? 'Войти' : 'Создать'}
                </Box>
              </Typography>
            </>
          ) : null}
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

export default AuthDialog
