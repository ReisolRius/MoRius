import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { brandLogo } from '../assets'
import authHero from '../assets/images/auth-hero-rebrand.webp'
import { GOOGLE_CLIENT_ID, IS_GOOGLE_AUTH_CONFIGURED } from '../config/env'
import {
  loginWithEmail,
  loginWithGoogleAccessToken,
  registerWithEmail,
  requestPasswordReset,
  verifyEmailRegistration,
  verifyPasswordReset,
} from '../services/authApi'
import type { AuthResponse } from '../types/auth'

export type AuthPageMode = 'login' | 'register' | 'reset'

type AuthPageProps = {
  initialMode: AuthPageMode
  onNavigate: (path: string) => void
  onAuthSuccess: (payload: AuthResponse) => void
}

type AuthFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  autoComplete?: string
  disabled?: boolean
  endLabel?: ReactNode
  inputMode?: 'email' | 'numeric' | 'text'
  maxLength?: number
  error?: boolean
  helperText?: string
}

const AUTH_EMAIL_MAX_LENGTH = 320
const AUTH_NICKNAME_MAX_LENGTH = 120
const AUTH_PASSWORD_MAX_LENGTH = 128
const AUTH_CODE_LENGTH = 6
const RESEND_COOLDOWN_SECONDS = 60
const RESEND_COOLDOWN_REGEX = /please wait\s+(\d+)\s+seconds?/i
const LOGIN_BUTTON_COLOR = '#578EEE'
const LOGIN_BUTTON_HOVER = '#477AD7'
const REGISTER_LINK_COLOR = '#578EEE'
const PAGE_BACKGROUND = '#121212'
const INPUT_BACKGROUND = '#1b2024'
const INPUT_TEXT = '#f1f1f1'
const MUTED_TEXT = '#8f98a3'
const BORDER_COLOR = '#343c45'

function extractResendCooldownSeconds(detail: string): number | null {
  const match = detail.match(RESEND_COOLDOWN_REGEX)
  if (!match) {
    return null
  }
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function formatCooldown(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / 60)
  const secondsPart = String(safeSeconds % 60).padStart(2, '0')
  return `${minutes}:${secondsPart}`
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function AuthField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  disabled = false,
  endLabel,
  inputMode = 'text',
  maxLength,
  error = false,
  helperText,
}: AuthFieldProps) {
  return (
    <Stack spacing={0.65}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Typography sx={{ color: INPUT_TEXT, fontSize: '1rem', fontWeight: 400, lineHeight: 1.2 }}>
          {label}
        </Typography>
        {endLabel}
      </Stack>
      <TextField
        value={value}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        error={error}
        helperText={helperText}
        onChange={(event) => onChange(event.target.value)}
        fullWidth
        inputProps={{ inputMode, maxLength }}
        sx={{
          '& .MuiOutlinedInput-root': {
            minHeight: 57,
            borderRadius: '11px',
            backgroundColor: INPUT_BACKGROUND,
            color: INPUT_TEXT,
            fontFamily: '"Nunito Sans", sans-serif',
            fontSize: '1rem',
            fontWeight: 400,
            '& fieldset': {
              borderColor: error ? '#ff6b6b' : 'transparent',
            },
            '&:hover fieldset': {
              borderColor: error ? '#ff8585' : 'color-mix(in srgb, #ffffff 12%, transparent)',
            },
            '&.Mui-focused fieldset': {
              borderColor: error ? '#ff8585' : 'color-mix(in srgb, #ffffff 22%, transparent)',
            },
            '&.Mui-disabled': {
              opacity: 0.68,
            },
          },
          '& .MuiInputBase-input::placeholder': {
            color: '#7f8790',
            opacity: 1,
          },
          '& .MuiFormHelperText-root': {
            mt: 0.6,
            mx: 0,
            color: '#ff8585',
            fontFamily: '"Nunito Sans", sans-serif',
            fontSize: '0.84rem',
            fontWeight: 700,
          },
        }}
      />
    </Stack>
  )
}

function TextButton({
  children,
  onClick,
  color = REGISTER_LINK_COLOR,
}: {
  children: ReactNode
  onClick: () => void
  color?: string
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        m: 0,
        p: 0,
        border: 'none',
        background: 'transparent',
        color,
        cursor: 'pointer',
        font: 'inherit',
        fontWeight: 400,
        textDecoration: 'underline',
        textUnderlineOffset: '2px',
      }}
    >
      {children}
    </Box>
  )
}

function GoogleGlyph() {
  return (
    <Box
      component="svg"
      aria-hidden
      viewBox="0 0 18 18"
      sx={{ width: 24, height: 24, display: 'block', flexShrink: 0 }}
    >
      <path
        fill="#4285F4"
        d="M17.64 9.204c0-.638-.057-1.252-.164-1.841H9v3.482h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.258h2.908c1.702-1.568 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.181l-2.908-2.258c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332C2.438 15.983 5.482 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.681 9c0-.593.103-1.17.283-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.441 1.346l2.581-2.582C13.463.892 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </Box>
  )
}

function GoogleAuthButton({
  disabled,
  onStart,
  onSuccess,
  onError,
}: {
  disabled: boolean
  onStart: () => void
  onSuccess: (payload: AuthResponse) => void
  onError: (message: string) => void
}) {
  const login = useGoogleLogin({
    flow: 'implicit',
    scope: 'openid email profile',
    onSuccess: async (tokenResponse) => {
      const accessToken = tokenResponse.access_token
      if (!accessToken) {
        onError('Не удалось получить токен Google.')
        return
      }
      onStart()
      try {
        const authResult = await loginWithGoogleAccessToken(accessToken)
        onSuccess(authResult)
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Ошибка входа через Google')
      }
    },
    onError: () => onError('Не удалось войти через Google.'),
  })

  return (
    <Button
      type="button"
      fullWidth
      disabled={disabled}
      onClick={() => login()}
      sx={{
        minHeight: 58,
        borderRadius: '10px',
        border: `1px solid ${BORDER_COLOR}`,
        color: INPUT_TEXT,
        backgroundColor: 'transparent',
        fontFamily: '"Nunito Sans", sans-serif',
        fontSize: '1rem',
        fontWeight: 700,
        textTransform: 'none',
        gap: 1.2,
        '&:hover': {
          backgroundColor: '#171a1d',
          borderColor: '#47505b',
        },
      }}
    >
      <GoogleGlyph />
      Войти через Google
    </Button>
  )
}

export default function AuthPage({ initialMode, onNavigate, onAuthSuccess }: AuthPageProps) {
  const [mode, setMode] = useState<AuthPageMode>(initialMode)
  const [registerStep, setRegisterStep] = useState<'credentials' | 'verify'>('credentials')
  const [resetStep, setResetStep] = useState<'email' | 'verify'>('email')
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [infoMessage, setInfoMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false)
  const [isAuthHeroLoaded, setIsAuthHeroLoaded] = useState(false)
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0)

  const isLoginMode = mode === 'login'
  const isRegisterMode = mode === 'register'
  const isResetMode = mode === 'reset'
  const isRegisterVerificationStep = isRegisterMode && registerStep === 'verify'
  const isResetVerificationStep = isResetMode && resetStep === 'verify'
  const shouldShowGoogle = !isRegisterVerificationStep && !isResetMode
  const hasGoogleClientId = IS_GOOGLE_AUTH_CONFIGURED && Boolean(GOOGLE_CLIENT_ID)
  const shouldValidatePasswordMatch =
    (isRegisterMode && registerStep === 'credentials') || isResetVerificationStep
  const isPasswordMismatchVisible =
    shouldValidatePasswordMatch &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password !== confirmPassword

  useEffect(() => {
    const rootElement = document.getElementById('root')
    const previousBodyOverflow = document.body.style.overflow
    const previousBodyBackground = document.body.style.background
    const previousHtmlBackground = document.documentElement.style.background
    const previousRootBackground = rootElement?.style.background ?? ''
    const authRouteClass = 'morius-auth-route'

    document.body.classList.add(authRouteClass)
    document.body.style.overflow = 'hidden'
    document.body.style.background = PAGE_BACKGROUND
    document.documentElement.style.background = PAGE_BACKGROUND
    if (rootElement) {
      rootElement.style.background = PAGE_BACKGROUND
    }

    return () => {
      document.body.classList.remove(authRouteClass)
      document.body.style.overflow = previousBodyOverflow
      document.body.style.background = previousBodyBackground
      document.documentElement.style.background = previousHtmlBackground
      if (rootElement) {
        rootElement.style.background = previousRootBackground
      }
    }
  }, [])

  useEffect(() => {
    setMode(initialMode)
    setRegisterStep('credentials')
    setResetStep('email')
    setErrorMessage('')
    setInfoMessage('')
    setVerificationCode('')
    setResendCooldownSeconds(0)
  }, [initialMode])

  useEffect(() => {
    if (resendCooldownSeconds <= 0) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      setResendCooldownSeconds((previous) => (previous > 0 ? previous - 1 : 0))
    }, 1000)
    return () => window.clearTimeout(timeoutId)
  }, [resendCooldownSeconds])

  const startCooldown = (seconds = RESEND_COOLDOWN_SECONDS) => {
    setResendCooldownSeconds(Math.max(0, seconds))
  }

  const switchMode = (nextMode: AuthPageMode) => {
    setMode(nextMode)
    setRegisterStep('credentials')
    setResetStep('email')
    setVerificationCode('')
    setErrorMessage('')
    setInfoMessage('')
    setResendCooldownSeconds(0)
    onNavigate(`/auth?mode=${nextMode}`)
  }

  const submitLogin = async () => {
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail) {
      setErrorMessage('Укажите электронную почту.')
      return
    }
    if (!password) {
      setErrorMessage('Укажите пароль.')
      return
    }

    setIsSubmitting(true)
    try {
      const authResult = await loginWithEmail({ email: normalizedEmail, password })
      onAuthSuccess(authResult)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Ошибка входа')
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitRegistration = async () => {
    const normalizedEmail = normalizeEmail(email)
    const normalizedNickname = nickname.trim()
    if (!normalizedEmail) {
      setErrorMessage('Укажите электронную почту.')
      return
    }
    if (!normalizedNickname) {
      setErrorMessage('Укажите никнейм.')
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
    if (!acceptedTerms) {
      setErrorMessage('Примите пользовательское соглашение и политику конфиденциальности.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await registerWithEmail({
        email: normalizedEmail,
        display_name: normalizedNickname,
        password,
        accepted_terms: true,
      })
      setRegisterStep('verify')
      startCooldown()
      setInfoMessage(response.message || 'Код подтверждения отправлен на вашу почту.')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Ошибка регистрации'
      const cooldown = extractResendCooldownSeconds(detail)
      if (cooldown) {
        setRegisterStep('verify')
        startCooldown(cooldown)
        setInfoMessage(`Повторная отправка будет доступна через ${formatCooldown(cooldown)}.`)
      } else {
        setErrorMessage(detail)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitRegistrationCode = async () => {
    const normalizedEmail = normalizeEmail(email)
    const cleanedCode = verificationCode.trim()
    if (!/^\d{6}$/.test(cleanedCode)) {
      setErrorMessage('Введите 6-значный код из письма.')
      return
    }

    setIsSubmitting(true)
    try {
      const authResult = await verifyEmailRegistration({ email: normalizedEmail, code: cleanedCode })
      onAuthSuccess(authResult)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Ошибка подтверждения email')
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitResetEmail = async () => {
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail) {
      setErrorMessage('Укажите электронную почту.')
      return
    }
    setIsSubmitting(true)
    try {
      const response = await requestPasswordReset({ email: normalizedEmail })
      setResetStep('verify')
      startCooldown()
      setInfoMessage(response.message || 'Если аккаунт существует, код отправлен на почту.')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Ошибка восстановления пароля'
      const cooldown = extractResendCooldownSeconds(detail)
      if (cooldown) {
        setResetStep('verify')
        startCooldown(cooldown)
        setInfoMessage(`Повторная отправка будет доступна через ${formatCooldown(cooldown)}.`)
      } else {
        setErrorMessage(detail)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitResetCode = async () => {
    const normalizedEmail = normalizeEmail(email)
    const cleanedCode = verificationCode.trim()
    if (!/^\d{6}$/.test(cleanedCode)) {
      setErrorMessage('Введите 6-значный код из письма.')
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
      const authResult = await verifyPasswordReset({
        email: normalizedEmail,
        code: cleanedCode,
        password,
      })
      onAuthSuccess(authResult)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Ошибка восстановления пароля')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resendCode = async () => {
    if (resendCooldownSeconds > 0) {
      setInfoMessage(`Повторная отправка будет доступна через ${formatCooldown(resendCooldownSeconds)}.`)
      return
    }
    setErrorMessage('')
    setInfoMessage('')
    if (isRegisterVerificationStep) {
      await submitRegistration()
      return
    }
    await submitResetEmail()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage('')
    setInfoMessage('')

    if (isLoginMode) {
      await submitLogin()
      return
    }
    if (isRegisterMode) {
      if (registerStep === 'verify') {
        await submitRegistrationCode()
      } else {
        await submitRegistration()
      }
      return
    }
    if (resetStep === 'verify') {
      await submitResetCode()
    } else {
      await submitResetEmail()
    }
  }

  const formTitle = isLoginMode ? 'Рады вас видеть!' : isRegisterMode ? 'Добро пожаловать!' : 'Восстановление пароля'
  const submitLabel = isLoginMode
    ? 'Войти'
    : isRegisterVerificationStep
      ? 'Подтвердить email'
      : isRegisterMode
        ? 'Зарегистрироваться'
        : isResetVerificationStep
          ? 'Сохранить пароль'
          : 'Отправить код'

  return (
    <Box
      className="morius-auth-page-root"
      sx={{
        height: '100dvh',
        minHeight: '100dvh',
        width: '100vw',
        maxWidth: '100vw',
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        isolation: 'isolate',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
        backgroundColor: PAGE_BACKGROUND,
        color: INPUT_TEXT,
        fontFamily: '"Nunito Sans", sans-serif',
        overflow: 'hidden',
      }}
    >
      <Box
        aria-hidden
        sx={{
          display: { xs: 'none', md: 'block' },
          position: 'relative',
          width: '100%',
          minWidth: 0,
          height: '100dvh',
          minHeight: '100dvh',
          boxSizing: 'border-box',
          p: 0,
          backgroundColor: PAGE_BACKGROUND,
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            borderRadius: 0,
            background:
              'radial-gradient(ellipse at 35% 18%, rgba(87,142,238,0.18) 0%, transparent 42%), linear-gradient(180deg, #111927 0%, #121212 100%)',
          }}
        >
          <Box
            component="img"
            src={authHero}
            alt=""
            loading="eager"
            decoding="async"
            onLoad={() => setIsAuthHeroLoaded(true)}
            onError={() => setIsAuthHeroLoaded(true)}
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              display: 'block',
              objectFit: 'cover',
              objectPosition: '32% center',
              opacity: isAuthHeroLoaded ? 1 : 0,
              transform: isAuthHeroLoaded ? 'scale(1)' : 'scale(1.012)',
              transformOrigin: '32% center',
              transition: 'opacity 720ms ease, transform 900ms ease',
            }}
          />
        </Box>
      </Box>
      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          height: '100dvh',
          minHeight: 0,
          width: '100%',
          minWidth: 0,
          display: 'flex',
          alignItems: { xs: 'flex-start', md: 'center' },
          justifyContent: 'center',
          boxSizing: 'border-box',
          px: { xs: 2, sm: 4, md: 7 },
          py: { xs: 9, md: 6 },
          overflowX: 'hidden',
          overflowY: 'auto',
        }}
      >
        <Box
          component="button"
          type="button"
          onClick={() => onNavigate('/')}
          sx={{
            position: 'absolute',
            top: { xs: 22, md: 25 },
            right: { xs: '50%', md: 30 },
            transform: { xs: 'translateX(50%)', md: 'none' },
            width: { xs: 86, md: 92 },
            p: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
          }}
          aria-label="На главную"
        >
          <Box component="img" src={brandLogo} alt="MoRius" sx={{ width: '100%', display: 'block' }} />
        </Box>

        <Box sx={{ width: '100%', maxWidth: { xs: 'calc(100vw - 32px)', sm: 500 }, minWidth: 0, mx: 'auto' }}>
          <Typography
            component="h1"
            sx={{
              mb: { xs: 3.2, md: 3.6 },
              textAlign: 'center',
              color: '#ffffff',
              fontFamily: '"Nunito Sans", sans-serif',
              fontSize: { xs: '1.68rem', sm: '1.85rem', md: '2rem' },
              lineHeight: 1.15,
              fontWeight: 700,
              letterSpacing: 0,
            }}
          >
            {formTitle}
          </Typography>

          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2.25}>
              <AuthField
                label="Электронная почта"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="mail@example.ru"
                autoComplete="email"
                disabled={isRegisterVerificationStep || isResetVerificationStep}
                inputMode="email"
                maxLength={AUTH_EMAIL_MAX_LENGTH}
              />

              {isRegisterMode && registerStep === 'credentials' ? (
                <AuthField
                  label="Никнейм"
                  value={nickname}
                  onChange={setNickname}
                  placeholder="Ваш никнейм"
                  autoComplete="nickname"
                  maxLength={AUTH_NICKNAME_MAX_LENGTH}
                />
              ) : null}

              {isRegisterVerificationStep || isResetVerificationStep ? (
                <AuthField
                  label="Код из письма"
                  value={verificationCode}
                  onChange={setVerificationCode}
                  placeholder="000000"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={AUTH_CODE_LENGTH}
                />
              ) : null}

              {isLoginMode ? (
                <AuthField
                  label="Пароль"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                  maxLength={AUTH_PASSWORD_MAX_LENGTH}
                  endLabel={
                    <TextButton color="#5f6b78" onClick={() => switchMode('reset')}>
                      Забыли пароль?
                    </TextButton>
                  }
                />
              ) : null}

              {isRegisterMode && registerStep === 'credentials' ? (
                <>
                  <AuthField
                    label="Пароль"
                    type="password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                    maxLength={AUTH_PASSWORD_MAX_LENGTH}
                  />
                  <AuthField
                    label="Повторите пароль"
                    type="password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    autoComplete="new-password"
                    maxLength={AUTH_PASSWORD_MAX_LENGTH}
                    error={isPasswordMismatchVisible}
                    helperText={isPasswordMismatchVisible ? 'Пароли не совпадают.' : undefined}
                  />
                  <Stack direction="row" spacing={1.1} alignItems="flex-start">
                    <Checkbox
                      checked={acceptedTerms}
                      onChange={(event) => setAcceptedTerms(event.target.checked)}
                      sx={{
                        p: 0.15,
                        mt: 0.1,
                        color: '#6f7881',
                        '&.Mui-checked': { color: LOGIN_BUTTON_COLOR },
                      }}
                    />
                    <Typography sx={{ color: '#d7d7d7', fontSize: '0.88rem', lineHeight: 1.45, fontWeight: 400 }}>
                      Я принимаю условия{' '}
                      <TextButton onClick={() => onNavigate('/terms-of-service')}>пользовательского соглашения</TextButton>
                      {' '}и{' '}
                      <TextButton onClick={() => onNavigate('/privacy-policy')}>Политики конфиденциальности</TextButton>.
                    </Typography>
                  </Stack>
                </>
              ) : null}

              {isResetVerificationStep ? (
                <>
                  <AuthField
                    label="Новый пароль"
                    type="password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                    maxLength={AUTH_PASSWORD_MAX_LENGTH}
                  />
                  <AuthField
                    label="Повторите пароль"
                    type="password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    autoComplete="new-password"
                    maxLength={AUTH_PASSWORD_MAX_LENGTH}
                    error={isPasswordMismatchVisible}
                    helperText={isPasswordMismatchVisible ? 'Пароли не совпадают.' : undefined}
                  />
                </>
              ) : null}

              {infoMessage ? <Alert severity="info">{infoMessage}</Alert> : null}
              {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

              {(isRegisterVerificationStep || isResetVerificationStep) ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button
                    type="button"
                    disabled={isSubmitting || resendCooldownSeconds > 0}
                    onClick={() => void resendCode()}
                    sx={{
                      minHeight: 38,
                      color: MUTED_TEXT,
                      textTransform: 'none',
                      fontWeight: 400,
                      '&:hover': { color: INPUT_TEXT, backgroundColor: 'transparent' },
                    }}
                  >
                    {resendCooldownSeconds > 0
                      ? `Отправить снова через ${formatCooldown(resendCooldownSeconds)}`
                      : 'Отправить код снова'}
                  </Button>
                  <Button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      if (isRegisterVerificationStep) {
                        setRegisterStep('credentials')
                      } else {
                        setResetStep('email')
                      }
                      setVerificationCode('')
                      setInfoMessage('')
                      setErrorMessage('')
                      setResendCooldownSeconds(0)
                    }}
                    sx={{
                      minHeight: 38,
                      color: MUTED_TEXT,
                      textTransform: 'none',
                      fontWeight: 400,
                      '&:hover': { color: INPUT_TEXT, backgroundColor: 'transparent' },
                    }}
                  >
                    Изменить данные
                  </Button>
                </Stack>
              ) : null}

              <Button
                type="submit"
                fullWidth
                disabled={isSubmitting || isGoogleSubmitting}
                sx={{
                  mt: { xs: 0.7, md: 1.2 },
                  minHeight: 57,
                  borderRadius: '10px',
                  border: 'none',
                  background: `${LOGIN_BUTTON_COLOR} !important`,
                  color: '#ffffff !important',
                  fontFamily: '"Nunito Sans", sans-serif',
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  textTransform: 'none',
                  '&:hover, &:focus, &:active, &.Mui-focusVisible': {
                    background: `${LOGIN_BUTTON_HOVER} !important`,
                    color: '#ffffff !important',
                  },
                  '&:disabled': {
                    opacity: 0.66,
                    background: `${LOGIN_BUTTON_COLOR} !important`,
                    color: '#ffffff !important',
                  },
                }}
              >
                {isSubmitting ? <CircularProgress size={22} sx={{ color: '#ffffff' }} /> : submitLabel}
              </Button>

              {shouldShowGoogle ? (
                <Stack spacing={2.3} sx={{ pt: { xs: 1.8, md: 2.8 } }}>
                  <Typography sx={{ textAlign: 'center', color: '#f0f0f0', fontSize: '1rem', fontWeight: 400 }}>
                    Или войдите через
                  </Typography>
                  {hasGoogleClientId ? (
                    <GoogleAuthButton
                      disabled={isSubmitting || isGoogleSubmitting}
                      onStart={() => {
                        setErrorMessage('')
                        setInfoMessage('')
                        setIsGoogleSubmitting(true)
                      }}
                      onSuccess={onAuthSuccess}
                      onError={(message) => {
                        setErrorMessage(message)
                        setIsGoogleSubmitting(false)
                      }}
                    />
                  ) : (
                    <Alert severity="warning">
                      Google вход отключен. Проверьте VITE_GOOGLE_CLIENT_ID во frontend/.env и GOOGLE_CLIENT_ID в backend/.env.
                    </Alert>
                  )}
                  {isGoogleSubmitting ? (
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
                      <CircularProgress size={16} />
                      <Typography sx={{ color: MUTED_TEXT, fontSize: '0.86rem' }}>Проверяем Google аккаунт...</Typography>
                    </Stack>
                  ) : null}
                </Stack>
              ) : null}

              <Typography sx={{ pt: 0.6, textAlign: 'center', color: '#d7d7d7', fontSize: '0.9rem', fontWeight: 400 }}>
                {isLoginMode ? (
                  <>
                    Еще нет аккаунта?{' '}
                    <TextButton onClick={() => switchMode('register')}>Зарегистрируйтесь</TextButton>
                  </>
                ) : isRegisterMode ? (
                  <>
                    Уже есть аккаунт?{' '}
                    <TextButton onClick={() => switchMode('login')}>Войдите</TextButton>
                  </>
                ) : (
                  <>
                    Вспомнили пароль?{' '}
                    <TextButton onClick={() => switchMode('login')}>Войдите</TextButton>
                  </>
                )}
              </Typography>
            </Stack>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
