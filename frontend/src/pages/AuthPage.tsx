import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import { Alert, Box, Button, Checkbox, CircularProgress, Collapse, Stack, Typography } from '@mui/material'
import { brandLogo } from '../assets'
import { GOOGLE_CLIENT_ID, IS_GOOGLE_AUTH_CONFIGURED } from '../config/env'
import {
  loginWithEmail,
  loginWithGoogleAccessToken,
  registerWithEmail,
  requestPasswordReset,
  startVKIDOAuth,
  startYandexOAuth,
  verifyEmailRegistration,
  verifyPasswordReset,
} from '../services/authApi'
import type { AuthResponse } from '../types/auth'
import { ACCOUNT_REQUIRED_MESSAGES, peekAuthReturnPath, type AccountRequiredReason } from '../utils/guestSession'

const authHero = '/landing/auth.webp'

export type AuthPageMode = 'login' | 'register' | 'reset'

type AuthPageProps = {
  initialMode: AuthPageMode
  /** Why the player was sent here - a guest who ran out of sols, a browser that has an account. */
  reason?: AccountRequiredReason | null
  /** The guest this browser is playing as; its worlds move into the account after sign-in. */
  guestName?: string | null
  isGuestSession?: boolean
  onNavigate: (path: string) => void
  onAuthSuccess: (payload: AuthResponse) => void
}

type StepId = 'email' | 'nickname' | 'password' | 'confirm' | 'code'

type StepConfig = {
  id: StepId
  label: string
  value: string
  onChange: (value: string) => void
  isValid: boolean
  type?: string
  placeholder?: string
  autoComplete?: string
  inputMode?: 'email' | 'numeric' | 'text'
  maxLength?: number
  disabled?: boolean
  hint?: string
  error?: string
  endLabel?: ReactNode
}

const AUTH_EMAIL_MAX_LENGTH = 320
const AUTH_NICKNAME_MAX_LENGTH = 120
const AUTH_PASSWORD_MAX_LENGTH = 128
const AUTH_CODE_LENGTH = 6
const PASSWORD_MIN_LENGTH = 8
const RESEND_COOLDOWN_SECONDS = 60
const RESEND_COOLDOWN_REGEX = /please wait\s+(\d+)\s+seconds?/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
/** How long typing has to pause before a valid field opens the next one. */
const STEP_REVEAL_DELAY_MS = 420

const ACCENT = '#f8ae2c'
const PAGE_BACKGROUND = '#000000'
const PANEL_BACKGROUND = '#0d0e0f'
const INPUT_BACKGROUND = '#1b1f22'
const INPUT_TEXT = '#f9f7f4'
const MUTED_TEXT = '#828a92'
const BORDER_COLOR = 'rgba(199,231,255,0.13)'
const ERROR_TEXT = '#ff8585'
const SOFT_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

// Every field sits in a slot of the same height, so the space a field will take is reserved
// before it appears and nothing below it ever moves while the form fills in.
const STEP_LABEL_HEIGHT = 18
const STEP_LABEL_GAP = 6
const STEP_INPUT_HEIGHT = 48
const STEP_GAP = 12
const STEP_SLOT_HEIGHT = STEP_LABEL_HEIGHT + STEP_LABEL_GAP + STEP_INPUT_HEIGHT
const RAIL_WIDTH = 26
const RAIL_X = 5

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

function stepTop(index: number): number {
  return index * (STEP_SLOT_HEIGHT + STEP_GAP)
}

function stepsAreaHeight(count: number): number {
  return count > 0 ? stepTop(count - 1) + STEP_SLOT_HEIGHT : 0
}

function TextButton({
  children,
  onClick,
  color = ACCENT,
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
        '&:hover': { filter: 'brightness(1.15)' },
      }}
    >
      {children}
    </Box>
  )
}

function GoogleGlyph() {
  return (
    <Box component="svg" aria-hidden viewBox="0 0 18 18" sx={{ width: 24, height: 24, display: 'block', flexShrink: 0 }}>
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

function ProviderGlyph({ provider }: { provider: 'vk' | 'yandex' | 'mail' }) {
  const config = {
    vk: { label: 'VK', color: '#2787f5', fontSize: '0.62rem' },
    yandex: { label: 'Я', color: '#fc3f1d', fontSize: '1.15rem' },
    mail: { label: '@', color: '#168de2', fontSize: '1.05rem' },
  }[provider]

  return (
    <Box
      aria-hidden
      sx={{
        width: 24,
        height: 24,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        borderRadius: provider === 'vk' ? '6px' : '50%',
        color: provider === 'vk' ? '#ffffff' : config.color,
        backgroundColor: provider === 'vk' ? config.color : 'transparent',
        fontFamily: '"Manrope", sans-serif',
        fontSize: config.fontSize,
        fontWeight: 900,
        lineHeight: 1,
      }}
    >
      {config.label}
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
        minHeight: 52,
        borderRadius: 'var(--morius-button-radius, 12px)',
        border: `1px solid ${BORDER_COLOR}`,
        color: INPUT_TEXT,
        backgroundColor: 'transparent',
        fontFamily: '"Manrope", sans-serif',
        fontSize: '1rem',
        fontWeight: 700,
        textTransform: 'none',
        gap: 1.2,
        '&:hover': { backgroundColor: '#171a1d', borderColor: '#47505b' },
      }}
    >
      <GoogleGlyph />
      Войти через Google
    </Button>
  )
}

function ProviderAuthButton({
  provider,
  label,
  disabled,
  busy,
  onClick,
}: {
  provider: 'vk' | 'yandex' | 'mail'
  label: string
  disabled: boolean
  busy: boolean
  onClick: () => void
}) {
  const hoverColor = provider === 'yandex' ? '#fc3f1d' : provider === 'vk' ? '#2787f5' : '#168de2'
  return (
    <Button
      type="button"
      fullWidth
      disabled={disabled}
      onClick={onClick}
      aria-busy={busy || undefined}
      sx={{
        minHeight: 42,
        borderRadius: 'var(--morius-button-radius, 12px)',
        border: `1px solid ${BORDER_COLOR}`,
        color: INPUT_TEXT,
        backgroundColor: 'transparent',
        fontFamily: '"Manrope", sans-serif',
        fontSize: '0.8rem',
        fontWeight: 700,
        textTransform: 'none',
        minWidth: 0,
        px: 0.5,
        gap: 0.7,
        transition: 'border-color 180ms ease, background-color 180ms ease',
        '&:hover': { backgroundColor: '#171a1d', borderColor: hoverColor },
        '&.Mui-disabled': { color: busy ? INPUT_TEXT : '#5c636b', borderColor: busy ? hoverColor : BORDER_COLOR },
      }}
    >
      {busy ? <CircularProgress size={18} thickness={5} sx={{ color: hoverColor }} /> : <ProviderGlyph provider={provider} />}
      {label}
    </Button>
  )
}

/**
 * One field of the stepped form. Its slot is always there; until the step is reached the field
 * inside it stays invisible and out of the tab order, then fades down into place.
 */
function StepField({
  step,
  index,
  revealed,
  done,
  current,
  inputRef,
  onKeyDown,
  onBlur,
}: {
  step: StepConfig
  index: number
  revealed: boolean
  done: boolean
  current: boolean
  inputRef: (node: HTMLInputElement | null) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onBlur: () => void
}) {
  const inputId = `auth-step-${step.id}`
  const hasError = Boolean(step.error)
  const dotColor = hasError ? ERROR_TEXT : done || current ? ACCENT : 'rgba(199,231,255,0.28)'
  return (
    <Box
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: stepTop(index),
        height: STEP_SLOT_HEIGHT,
        transition: `top 460ms ${SOFT_EASE}`,
      }}
    >
      {/* The dot on the progress rail for this field. */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          left: RAIL_X - 4,
          top: STEP_LABEL_HEIGHT / 2 - 5,
          width: 10,
          height: 10,
          borderRadius: '50%',
          boxSizing: 'border-box',
          border: `2px solid ${dotColor}`,
          backgroundColor: done && !hasError ? ACCENT : PAGE_BACKGROUND,
          boxShadow: current && !hasError ? `0 0 0 4px rgba(248,174,44,0.16)` : 'none',
          opacity: revealed ? 1 : 0.55,
          transition: `background-color 320ms ease, border-color 320ms ease, box-shadow 320ms ease, opacity 320ms ease`,
          zIndex: 1,
        }}
      />
      <Box
        aria-hidden={!revealed}
        sx={{
          position: 'absolute',
          left: RAIL_WIDTH,
          right: 0,
          top: 0,
          height: '100%',
          opacity: revealed ? 1 : 0,
          transform: revealed ? 'translateY(0)' : 'translateY(-12px)',
          filter: revealed ? 'blur(0)' : 'blur(3px)',
          visibility: revealed ? 'visible' : 'hidden',
          pointerEvents: revealed ? 'auto' : 'none',
          transition: revealed
            ? `opacity 520ms ${SOFT_EASE} 140ms, transform 560ms ${SOFT_EASE} 140ms, filter 520ms ease 140ms, visibility 0s linear 0s`
            : `opacity 240ms ease, transform 240ms ease, filter 240ms ease, visibility 0s linear 240ms`,
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          sx={{ height: STEP_LABEL_HEIGHT, mb: `${STEP_LABEL_GAP}px` }}
        >
          <Box
            component="label"
            htmlFor={inputId}
            sx={{ color: INPUT_TEXT, fontSize: '0.92rem', lineHeight: 1.2, fontWeight: 500, whiteSpace: 'nowrap' }}
          >
            {step.label}
          </Box>
          {hasError ? (
            <Box sx={{ color: ERROR_TEXT, fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {step.error}
            </Box>
          ) : step.endLabel ? (
            step.endLabel
          ) : step.hint ? (
            <Box sx={{ color: MUTED_TEXT, fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {step.hint}
            </Box>
          ) : null}
        </Stack>
        <Box
          component="input"
          id={inputId}
          ref={inputRef}
          value={step.value}
          type={step.type ?? 'text'}
          placeholder={step.placeholder}
          autoComplete={step.autoComplete}
          inputMode={step.inputMode}
          maxLength={step.maxLength}
          disabled={step.disabled}
          tabIndex={revealed ? 0 : -1}
          aria-invalid={hasError || undefined}
          onChange={(event) => step.onChange((event.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          sx={{
            display: 'block',
            width: '100%',
            height: STEP_INPUT_HEIGHT,
            boxSizing: 'border-box',
            px: '16px',
            borderRadius: '11px',
            border: `1px solid ${hasError ? ERROR_TEXT : 'transparent'}`,
            outline: 'none',
            backgroundColor: step.disabled ? '#272c30' : INPUT_BACKGROUND,
            color: step.disabled ? '#8c949c' : INPUT_TEXT,
            fontFamily: '"Manrope", sans-serif',
            fontSize: '1rem',
            transition: 'border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease',
            '&::placeholder': { color: '#6f7780', opacity: 1 },
            '&:hover:not(:disabled)': { borderColor: hasError ? ERROR_TEXT : 'rgba(255,255,255,0.12)' },
            '&:focus': {
              borderColor: hasError ? ERROR_TEXT : 'rgba(248,174,44,0.55)',
              boxShadow: hasError ? 'none' : '0 0 0 3px rgba(248,174,44,0.12)',
            },
            '&:-webkit-autofill': {
              WebkitBoxShadow: `0 0 0 100px ${INPUT_BACKGROUND} inset`,
              WebkitTextFillColor: INPUT_TEXT,
              caretColor: INPUT_TEXT,
            },
          }}
        />
      </Box>
    </Box>
  )
}

export default function AuthPage({
  initialMode,
  reason = null,
  guestName = null,
  isGuestSession = false,
  onNavigate,
  onAuthSuccess,
}: AuthPageProps) {
  const [mode, setMode] = useState<AuthPageMode>(initialMode)
  const [registerStep, setRegisterStep] = useState<'credentials' | 'verify'>('credentials')
  const [resetStep, setResetStep] = useState<'email' | 'verify'>('email')
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [acceptedAge, setAcceptedAge] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [infoMessage, setInfoMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false)
  const [isYandexSubmitting, setIsYandexSubmitting] = useState(false)
  const [vkIDSubmittingProvider, setVKIDSubmittingProvider] = useState<'vk' | 'mail' | null>(null)
  const [isAuthHeroLoaded, setIsAuthHeroLoaded] = useState(false)
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0)
  // The furthest field the player has reached in the current form. Only ever moves forward while
  // a form is open, so correcting an earlier field never hides the ones already filled in.
  const [reachedStep, setReachedStep] = useState(0)
  const [touchedSteps, setTouchedSteps] = useState<Partial<Record<StepId, boolean>>>({})
  const inputRefs = useRef<Partial<Record<StepId, HTMLInputElement | null>>>({})
  const formRef = useRef<HTMLFormElement | null>(null)

  const isLoginMode = mode === 'login'
  const isRegisterMode = mode === 'register'
  const isResetMode = mode === 'reset'
  const isRegisterVerificationStep = isRegisterMode && registerStep === 'verify'
  const isRegisterCredentialsStep = isRegisterMode && registerStep === 'credentials'
  const isResetVerificationStep = isResetMode && resetStep === 'verify'
  const shouldShowExternalAuth = !isRegisterVerificationStep && !isResetMode
  const shouldShowGoogle = false
  const hasGoogleClientId = IS_GOOGLE_AUTH_CONFIGURED && Boolean(GOOGLE_CLIENT_ID)
  const isExternalAuthSubmitting = isGoogleSubmitting || isYandexSubmitting || vkIDSubmittingProvider !== null
  const formKey = `${mode}:${isRegisterMode ? registerStep : isResetMode ? resetStep : 'form'}`

  const isEmailValid = EMAIL_PATTERN.test(normalizeEmail(email))
  const isNicknameValid = nickname.trim().length > 0
  const isNewPasswordValid = password.length >= PASSWORD_MIN_LENGTH
  const isConfirmValid = confirmPassword.length > 0 && confirmPassword === password
  const isCodeValid = /^\d{6}$/.test(verificationCode.trim())

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

  const switchMode = (nextMode: AuthPageMode) => {
    setMode(nextMode)
    setRegisterStep('credentials')
    setResetStep('email')
    setVerificationCode('')
    setErrorMessage('')
    setInfoMessage('')
    setResendCooldownSeconds(0)
    onNavigate(`/auth?mode=${nextMode}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`)
  }
  const switchModeRef = useRef(switchMode)
  switchModeRef.current = switchMode

  const markTouched = useCallback((stepId: StepId) => {
    setTouchedSteps((previous) => (previous[stepId] ? previous : { ...previous, [stepId]: true }))
  }, [])

  const steps: StepConfig[] = useMemo(() => {
    const emailStep: StepConfig = {
      id: 'email',
      label: 'Электронная почта',
      value: email,
      onChange: setEmail,
      isValid: isEmailValid,
      type: 'email',
      placeholder: 'mail@example.ru',
      autoComplete: 'email',
      inputMode: 'email',
      maxLength: AUTH_EMAIL_MAX_LENGTH,
      disabled: isRegisterVerificationStep || isResetVerificationStep,
      error: touchedSteps.email && email.trim() && !isEmailValid ? 'Проверьте адрес' : undefined,
    }
    const newPasswordStep = (label: string): StepConfig => ({
      id: 'password',
      label,
      value: password,
      onChange: setPassword,
      isValid: isNewPasswordValid,
      type: 'password',
      autoComplete: 'new-password',
      maxLength: AUTH_PASSWORD_MAX_LENGTH,
      hint: isNewPasswordValid ? undefined : `не короче ${PASSWORD_MIN_LENGTH} символов`,
      error: touchedSteps.password && password && !isNewPasswordValid ? `Минимум ${PASSWORD_MIN_LENGTH} символов` : undefined,
    })
    const confirmStep: StepConfig = {
      id: 'confirm',
      label: 'Повторите пароль',
      value: confirmPassword,
      onChange: setConfirmPassword,
      isValid: isConfirmValid,
      type: 'password',
      autoComplete: 'new-password',
      maxLength: AUTH_PASSWORD_MAX_LENGTH,
      error: confirmPassword && password && confirmPassword !== password && (touchedSteps.confirm || confirmPassword.length >= password.length)
        ? 'Пароли не совпадают'
        : undefined,
    }
    const codeStep: StepConfig = {
      id: 'code',
      label: 'Код из письма',
      value: verificationCode,
      onChange: (value) => setVerificationCode(value.replace(/\D/g, '').slice(0, AUTH_CODE_LENGTH)),
      isValid: isCodeValid,
      placeholder: '000000',
      autoComplete: 'one-time-code',
      inputMode: 'numeric',
      maxLength: AUTH_CODE_LENGTH,
      hint: 'шесть цифр',
    }

    if (isLoginMode) {
      return [
        emailStep,
        {
          id: 'password',
          label: 'Пароль',
          value: password,
          onChange: setPassword,
          isValid: password.length > 0,
          type: 'password',
          autoComplete: 'current-password',
          maxLength: AUTH_PASSWORD_MAX_LENGTH,
          endLabel: (
            <Box sx={{ fontSize: '0.8rem' }}>
              <TextButton color="#7d8791" onClick={() => switchModeRef.current('reset')}>
                Забыли пароль?
              </TextButton>
            </Box>
          ),
        },
      ]
    }
    if (isRegisterVerificationStep) {
      return [emailStep, codeStep]
    }
    if (isRegisterMode) {
      return [
        emailStep,
        {
          id: 'nickname',
          label: 'Никнейм',
          value: nickname,
          onChange: setNickname,
          isValid: isNicknameValid,
          placeholder: 'Как тебя называть в историях',
          autoComplete: 'nickname',
          maxLength: AUTH_NICKNAME_MAX_LENGTH,
        },
        newPasswordStep('Пароль'),
        confirmStep,
      ]
    }
    if (isResetVerificationStep) {
      return [emailStep, codeStep, newPasswordStep('Новый пароль'), confirmStep]
    }
    return [emailStep]
  }, [
    confirmPassword,
    email,
    isCodeValid,
    isConfirmValid,
    isEmailValid,
    isLoginMode,
    isNewPasswordValid,
    isNicknameValid,
    isRegisterMode,
    isRegisterVerificationStep,
    isResetVerificationStep,
    nickname,
    password,
    touchedSteps.confirm,
    touchedSteps.email,
    touchedSteps.password,
    verificationCode,
  ])

  // A new form starts at its first open field. Verification forms open on the code, since the
  // e-mail above it is already settled.
  useEffect(() => {
    setReachedStep(isRegisterVerificationStep || isResetVerificationStep ? 1 : 0)
    setTouchedSteps({})
  }, [formKey, isRegisterVerificationStep, isResetVerificationStep])

  // Typing pauses on a valid field -> the next field fades in. A browser that autofilled a later
  // field (a saved password) opens everything up to it at once.
  const validPrefixLength = useMemo(() => {
    let count = 0
    while (count < steps.length && steps[count].isValid) {
      count += 1
    }
    return count
  }, [steps])
  const autofilledIndex = useMemo(() => {
    let last = -1
    steps.forEach((step, index) => {
      if (step.value && index > last) {
        last = index
      }
    })
    return last
  }, [steps])

  useEffect(() => {
    if (autofilledIndex > reachedStep) {
      setReachedStep(Math.min(autofilledIndex, steps.length - 1))
      return
    }
    if (validPrefixLength <= reachedStep || reachedStep >= steps.length - 1) {
      return
    }
    const timerId = window.setTimeout(() => {
      setReachedStep((previous) => Math.max(previous, Math.min(validPrefixLength, steps.length - 1)))
    }, STEP_REVEAL_DELAY_MS)
    return () => window.clearTimeout(timerId)
  }, [autofilledIndex, reachedStep, steps.length, validPrefixLength])

  const revealedCount = Math.min(steps.length, reachedStep + 1)
  const doneCount = Math.min(validPrefixLength, revealedCount)
  const currentStepIndex = Math.min(doneCount, steps.length - 1)
  const isFormComplete = validPrefixLength === steps.length
  const isSubmitBlocked =
    isSubmitting ||
    isExternalAuthSubmitting ||
    !isFormComplete ||
    (isRegisterCredentialsStep && (!acceptedTerms || !acceptedAge))

  // A field that is about to appear cannot take focus yet; the request waits for the render
  // that reveals it (the effect below) instead of guessing a number of animation frames.
  const pendingFocusRef = useRef<StepId | null>(null)
  const tryFocusStep = useCallback((stepId: StepId): boolean => {
    const node = inputRefs.current[stepId]
    if (!node || node.disabled) {
      return false
    }
    const wrapper = node.parentElement
    if (wrapper && window.getComputedStyle(wrapper).visibility === 'hidden') {
      return false
    }
    node.focus()
    return document.activeElement === node
  }, [])
  const focusStep = useCallback(
    (stepId: StepId) => {
      pendingFocusRef.current = tryFocusStep(stepId) ? null : stepId
    },
    [tryFocusStep],
  )
  useEffect(() => {
    const pendingStepId = pendingFocusRef.current
    if (pendingStepId && tryFocusStep(pendingStepId)) {
      pendingFocusRef.current = null
    }
  })

  const handleStepKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    const isAdvanceKey = event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)
    if (!isAdvanceKey) {
      return
    }
    const step = steps[index]
    markTouched(step.id)
    const nextStep = steps[index + 1]
    if (event.key === 'Enter' && (!nextStep || isFormComplete)) {
      // Enter on the last field - or on any field of a complete form - sends it.
      return
    }
    if (!nextStep) {
      return
    }
    if (!step.isValid) {
      if (event.key === 'Enter') {
        event.preventDefault()
      }
      return
    }
    event.preventDefault()
    setReachedStep((previous) => Math.max(previous, index + 1))
    focusStep(nextStep.id)
  }

  const handleStepBlur = (index: number) => () => {
    const step = steps[index]
    markTouched(step.id)
    if (step.isValid && index + 1 < steps.length) {
      setReachedStep((previous) => Math.max(previous, index + 1))
    }
  }

  const startCooldown = (seconds = RESEND_COOLDOWN_SECONDS) => {
    setResendCooldownSeconds(Math.max(0, seconds))
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
    if (password.length < PASSWORD_MIN_LENGTH) {
      setErrorMessage(`Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов.`)
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
    if (!acceptedAge) {
      setErrorMessage('Подтвердите, что вам есть 18 лет.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await registerWithEmail({
        email: normalizedEmail,
        display_name: normalizedNickname,
        password,
        accepted_terms: true,
        accepted_age: true,
      })
      setRegisterStep('verify')
      startCooldown()
      setInfoMessage(response.message || 'Код подтверждения отправлен на вашу почту.')
      focusStep('code')
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
      focusStep('code')
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
    if (password.length < PASSWORD_MIN_LENGTH) {
      setErrorMessage(`Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов.`)
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
    if (isSubmitBlocked) {
      if (isSubmitting || isExternalAuthSubmitting) {
        return
      }
      // Enter on an unfinished form: point at the first field that still needs attention.
      const firstIncomplete = steps.find((step) => !step.isValid)
      if (firstIncomplete) {
        markTouched(firstIncomplete.id)
        setReachedStep((previous) => Math.max(previous, steps.indexOf(firstIncomplete)))
        focusStep(firstIncomplete.id)
      } else if (isRegisterCredentialsStep) {
        setErrorMessage('Отметь согласие с условиями и подтверди, что тебе есть 18 лет.')
      }
      return
    }
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

  const handleYandexAuth = async () => {
    if (isSubmitting || isExternalAuthSubmitting) {
      return
    }
    setErrorMessage('')
    setInfoMessage('')
    setIsYandexSubmitting(true)
    try {
      const response = await startYandexOAuth({
        action: 'login',
        return_path: '/auth',
      })
      window.location.assign(response.authorization_url)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось начать вход через Яндекс.')
      setIsYandexSubmitting(false)
    }
  }

  const handleVKIDAuth = async (provider: 'vk' | 'mail') => {
    if (isSubmitting || isExternalAuthSubmitting) {
      return
    }
    setErrorMessage('')
    setInfoMessage('')
    setVKIDSubmittingProvider(provider)
    try {
      const response = await startVKIDOAuth({
        action: 'login',
        provider,
        return_path: '/auth',
      })
      window.location.assign(response.authorization_url)
    } catch (error) {
      const providerLabel = provider === 'mail' ? 'Mail' : 'VK'
      setErrorMessage(error instanceof Error ? error.message : `Не удалось начать вход через ${providerLabel}.`)
      setVKIDSubmittingProvider(null)
    }
  }

  const formTitle = isLoginMode
    ? 'С возвращением.'
    : isRegisterVerificationStep
      ? 'Проверь почту.'
      : isRegisterMode
        ? 'Добро пожаловать.'
        : 'Восстановление пароля'
  const formKicker = isLoginMode ? 'История продолжается' : isRegisterMode ? 'Первая глава' : 'Вернуться в историю'
  const formSubtitle = isLoginMode
    ? 'Твои миры ждут. Продолжим историю?'
    : isRegisterVerificationStep
      ? 'Мы отправили код подтверждения на указанный адрес.'
      : isRegisterMode
        ? 'Создай аккаунт — и дай своей истории жизнь.'
        : isResetVerificationStep
          ? 'Введи код из письма и придумай новый пароль.'
          : 'Укажи почту своего аккаунта — пришлём код.'
  const showModeTabs = !isResetMode && !isRegisterVerificationStep
  const submitLabel = isLoginMode
    ? 'Войти'
    : isRegisterVerificationStep
      ? 'Подтвердить email'
      : isRegisterMode
        ? 'Зарегистрироваться'
        : isResetVerificationStep
          ? 'Сохранить пароль'
          : 'Отправить код'
  const reasonMessage = reason ? ACCOUNT_REQUIRED_MESSAGES[reason] : ''
  const guestLine = guestName ? `Всё, что создал ${guestName}, перейдёт в твой аккаунт.` : ''
  const hasNotice = Boolean(reasonMessage || guestLine)
  const railFillHeight = stepTop(currentStepIndex) + (isFormComplete ? STEP_LABEL_HEIGHT / 2 : 0)

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
        gridTemplateColumns: { xs: '1fr', md: '52% 48%' },
        backgroundColor: PAGE_BACKGROUND,
        color: INPUT_TEXT,
        fontFamily: '"Manrope", sans-serif',
        overflow: 'hidden',
        '@keyframes moriusAuthFadeIn': {
          from: { opacity: 0, transform: 'translateY(6px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
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
          backgroundColor: PAGE_BACKGROUND,
        }}
      >
        <Box sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: PANEL_BACKGROUND }}>
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
              objectPosition: 'center 38%',
              opacity: isAuthHeroLoaded ? 1 : 0,
              transform: isAuthHeroLoaded ? 'scale(1)' : 'scale(1.012)',
              transformOrigin: 'center 38%',
              transition: 'opacity 720ms ease, transform 900ms ease',
            }}
          />
          {/* Darkens the lower half so the copy below stays readable over the art. */}
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.45), transparent 30%, transparent 46%, rgba(0,0,0,0.72) 72%, rgba(0,0,0,0.94) 100%)',
            }}
          />
          <Box sx={{ position: 'absolute', zIndex: 1, top: 31, left: 36, right: 36, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Box component="img" src={brandLogo} alt="" sx={{ height: 34, width: 'auto', display: 'block' }} />
              <Box component="span" sx={{ fontFamily: 'var(--morius-font-heading, Georgia, serif)', fontSize: 32, color: INPUT_TEXT, letterSpacing: '0.5px' }}>
                Moru
              </Box>
            </Box>
            <Box sx={{ color: MUTED_TEXT, fontSize: 11, letterSpacing: '2px' }}>ТВОЙ МИР НАЧИНАЕТСЯ ЗДЕСЬ</Box>
          </Box>
          <Box sx={{ position: 'absolute', zIndex: 1, bottom: 44, left: '9%', right: '9%', color: INPUT_TEXT }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', fontWeight: 700, color: ACCENT, mb: '19px', '&:before': { content: '""', height: '1px', width: 31, background: 'currentColor' } }}>
              У каждой истории есть начало
            </Box>
            <Box component="h2" sx={{ fontFamily: 'var(--morius-font-heading, Georgia, serif)', fontWeight: 400, fontSize: 'clamp(36px, 3.5vw, 55px)', lineHeight: 1.12, letterSpacing: '-1.2px', m: '0 0 16px', color: INPUT_TEXT }}>
              За этой дверью —
              <br />
              <Box component="em" sx={{ color: ACCENT, fontStyle: 'normal' }}>твой новый мир.</Box>
            </Box>
            <Box component="p" sx={{ color: MUTED_TEXT, fontSize: 15, lineHeight: 1.8, maxWidth: 390, m: 0 }}>
              Я проведу тебя к первой главе.
              <br />
              А какой она будет — решать тебе.
            </Box>
            <Box sx={{ borderTop: `1px solid ${BORDER_COLOR}`, display: 'flex', justifyContent: 'space-between', gap: '20px', mt: '28px', pt: '22px', fontSize: 12, color: MUTED_TEXT }}>
              <span>Storytelling · D&amp;D · Новеллы</span>
              <span>Твои живые истории</span>
            </Box>
          </Box>
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
          backgroundColor: PAGE_BACKGROUND,
          boxSizing: 'border-box',
          overflowX: 'hidden',
          overflowY: 'auto',
        }}
      >
        {/* The torn seam from the mockup: the form side bites into the art in a ragged line
            instead of meeting it on a ruled edge. Black over the picture, so it reads. */}
        <Box
          aria-hidden
          sx={{
            display: { xs: 'none', md: 'block' },
            position: 'fixed',
            top: 0,
            left: 'calc(52% - 13px)',
            width: 15,
            height: '100dvh',
            backgroundColor: PAGE_BACKGROUND,
            clipPath:
              'polygon(100% 0,100% 100%,30% 100%,64% 97%,20% 94%,53% 91%,10% 88%,65% 85%,25% 82%,60% 79%,15% 76%,68% 73%,20% 70%,57% 67%,15% 64%,60% 61%,25% 58%,65% 55%,18% 52%,60% 49%,20% 46%,65% 43%,15% 40%,55% 37%,20% 34%,63% 31%,15% 28%,62% 25%,25% 22%,55% 19%,12% 16%,65% 13%,20% 10%,60% 7%,15% 4%,55% 0)',
            zIndex: 2,
            pointerEvents: 'none',
          }}
        />
        <Box
          sx={{
            minHeight: '100%',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
            px: { xs: 2, sm: 4, md: 7 },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 2,
              pt: { xs: '20px', md: '22px' },
              mx: { xs: '6px', md: '-22px' },
              fontSize: 12,
              color: MUTED_TEXT,
            }}
          >
            <Box
              component="button"
              type="button"
              onClick={() => onNavigate(isGuestSession ? peekAuthReturnPath() ?? '/dashboard' : '/')}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '9px',
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                font: 'inherit',
                cursor: 'pointer',
                p: 0,
                '&:hover': { color: INPUT_TEXT },
              }}
            >
              ← <Box component="span">{isGuestSession ? 'Вернуться к игре' : 'На главную'}</Box>
            </Box>
            <Box sx={{ letterSpacing: '1.5px', fontSize: 10, color: ACCENT, display: { xs: 'none', sm: 'block' } }}>
              ТВОИ ЖИВЫЕ ИСТОРИИ
            </Box>
          </Box>

          {/* Anchored to the top: switching tabs or opening fields never shifts what is above. */}
          <Box
            sx={{
              width: '100%',
              maxWidth: { xs: 'calc(100vw - 32px)', sm: 392 },
              minWidth: 0,
              mx: 'auto',
              pt: { xs: '22px', md: 'clamp(8px, 2vh, 28px)' },
              pb: 3,
            }}
          >
            {hasNotice ? (
              <Box
                role="status"
                sx={{
                  mb: 2.2,
                  p: '10px 13px',
                  borderRadius: '12px',
                  border: '1px solid rgba(248,174,44,0.32)',
                  background: 'linear-gradient(135deg, rgba(248,174,44,0.10), rgba(248,174,44,0.04))',
                  animation: `moriusAuthFadeIn 420ms ${SOFT_EASE}`,
                }}
              >
                {reasonMessage ? (
                  <Typography sx={{ color: INPUT_TEXT, fontSize: '0.84rem', fontWeight: 700, lineHeight: 1.4 }}>
                    {reasonMessage}
                  </Typography>
                ) : null}
                {guestLine ? (
                  <Typography sx={{ color: '#b9c0c7', fontSize: '0.78rem', lineHeight: 1.45, mt: reasonMessage ? 0.45 : 0 }}>
                    {guestLine}
                  </Typography>
                ) : null}
              </Box>
            ) : null}

            <Collapse in={showModeTabs} timeout={320}>
              <Box
                role="tablist"
                aria-label="Вход или регистрация"
                sx={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${BORDER_COLOR}`, mb: 3 }}
              >
                {([
                  { key: 'register', label: 'Регистрация' },
                  { key: 'login', label: 'Вход' },
                ] as const).map((tab) => {
                  const selected = mode === tab.key
                  return (
                    <Box
                      key={tab.key}
                      component="button"
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => {
                        if (!selected) {
                          switchMode(tab.key)
                        }
                      }}
                      sx={{
                        border: 0,
                        background: 'none',
                        font: 'inherit',
                        cursor: 'pointer',
                        p: '12px 6px',
                        fontSize: 14,
                        fontFamily: '"Manrope", sans-serif',
                        color: selected ? INPUT_TEXT : MUTED_TEXT,
                        fontWeight: selected ? 700 : 500,
                        transition: 'color 240ms ease',
                        '&:hover': { color: INPUT_TEXT },
                      }}
                    >
                      {tab.label}
                    </Box>
                  )
                })}
                {/* One underline that slides between the tabs instead of two that blink. */}
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    bottom: -1,
                    left: 0,
                    width: '50%',
                    height: 2,
                    background: ACCENT,
                    transform: mode === 'login' ? 'translateX(100%)' : 'translateX(0)',
                    transition: `transform 380ms ${SOFT_EASE}`,
                  }}
                />
              </Box>
            </Collapse>

            <Box sx={{ mb: 2.6 }}>
              {hasNotice ? null : (
                <Box
                  key={`kicker-${formKicker}`}
                  sx={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', fontWeight: 700, color: ACCENT, mb: '10px', animation: `moriusAuthFadeIn 360ms ${SOFT_EASE}`, '&:before': { content: '""', height: '1px', width: 31, background: 'currentColor' } }}
                >
                  {formKicker}
                </Box>
              )}
              <Typography
                key={`title-${formTitle}`}
                component="h1"
                sx={{
                  fontFamily: 'var(--morius-font-heading, Georgia, serif)',
                  fontWeight: 400,
                  fontSize: { xs: '1.9rem', md: '2.25rem' },
                  lineHeight: 1.12,
                  letterSpacing: '-1.1px',
                  color: INPUT_TEXT,
                  m: '0 0 8px',
                  whiteSpace: 'nowrap',
                  animation: `moriusAuthFadeIn 420ms ${SOFT_EASE}`,
                }}
              >
                {formTitle}
              </Typography>
              {/* With a notice above, the notice is the subtitle: it says why the player is here.
                  The code and reset steps keep theirs - it says what to do next. */}
              {hasNotice && !isRegisterVerificationStep && !isResetMode ? null : (
                <Typography
                  key={`subtitle-${formSubtitle}`}
                  sx={{ fontSize: 14, lineHeight: 1.65, color: MUTED_TEXT, m: 0, minHeight: '1.65em', animation: `moriusAuthFadeIn 480ms ${SOFT_EASE}` }}
                >
                  {formSubtitle}
                </Typography>
              )}
            </Box>

            <Box component="form" ref={formRef} onSubmit={handleSubmit} noValidate>
              {/* The progress rail and the fields. The area is as tall as all of this form's
                  fields from the start; fields fade into their slots as the player gets there. */}
              <Box
                sx={{
                  position: 'relative',
                  height: stepsAreaHeight(steps.length),
                  transition: `height 460ms ${SOFT_EASE}`,
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    left: RAIL_X,
                    top: STEP_LABEL_HEIGHT / 2,
                    width: 2,
                    height: Math.max(0, stepTop(steps.length - 1)),
                    borderRadius: 2,
                    backgroundColor: 'rgba(199,231,255,0.10)',
                    transition: `height 460ms ${SOFT_EASE}`,
                  }}
                />
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    left: RAIL_X,
                    top: STEP_LABEL_HEIGHT / 2,
                    width: 2,
                    height: Math.max(0, Math.min(railFillHeight, stepTop(steps.length - 1))),
                    borderRadius: 2,
                    background: `linear-gradient(180deg, ${ACCENT}, rgba(248,174,44,0.55))`,
                    boxShadow: '0 0 12px rgba(248,174,44,0.35)',
                    transition: `height 560ms ${SOFT_EASE}`,
                  }}
                />
                {steps.map((step, index) => (
                  <StepField
                    key={`${formKey}:${step.id}`}
                    step={step}
                    index={index}
                    revealed={index < revealedCount}
                    done={index < doneCount}
                    current={index === currentStepIndex && !isFormComplete}
                    inputRef={(node) => {
                      inputRefs.current[step.id] = node
                    }}
                    onKeyDown={handleStepKeyDown(index)}
                    onBlur={handleStepBlur(index)}
                  />
                ))}
              </Box>

              {/* Everything below the fields is there from the first frame. */}
              <Collapse in={isRegisterCredentialsStep} timeout={360}>
                <Stack spacing={1} sx={{ pt: 2 }}>
                  <Stack direction="row" spacing={1.1} alignItems="flex-start">
                    <Checkbox
                      checked={acceptedTerms}
                      onChange={(event) => setAcceptedTerms(event.target.checked)}
                      inputProps={{ 'aria-label': 'Принимаю пользовательское соглашение и политику конфиденциальности' }}
                      sx={{ p: 0.15, mt: 0.1, color: '#6f7881', '&.Mui-checked': { color: ACCENT } }}
                    />
                    <Typography sx={{ color: '#d7d7d7', fontSize: '0.82rem', lineHeight: 1.45, fontWeight: 400 }}>
                      Я принимаю условия{' '}
                      <TextButton onClick={() => onNavigate('/terms-of-service')}>пользовательского соглашения</TextButton>
                      {' '}и{' '}
                      <TextButton onClick={() => onNavigate('/privacy-policy')}>Политики конфиденциальности</TextButton>.
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1.1} alignItems="flex-start">
                    <Checkbox
                      checked={acceptedAge}
                      onChange={(event) => setAcceptedAge(event.target.checked)}
                      inputProps={{ 'aria-label': 'Подтверждаю, что мне есть 18 лет' }}
                      sx={{ p: 0.15, mt: 0.1, color: '#6f7881', '&.Mui-checked': { color: ACCENT } }}
                    />
                    <Typography sx={{ color: '#d7d7d7', fontSize: '0.82rem', lineHeight: 1.45, fontWeight: 400 }}>
                      Подтверждаю, что мне есть 18 лет.
                    </Typography>
                  </Stack>
                </Stack>
              </Collapse>

              <Collapse in={Boolean(infoMessage || errorMessage)} timeout={280}>
                <Stack spacing={1} sx={{ pt: 2.2 }}>
                  {infoMessage ? <Alert severity="info" onClose={() => setInfoMessage('')}>{infoMessage}</Alert> : null}
                  {errorMessage ? <Alert severity="error" onClose={() => setErrorMessage('')}>{errorMessage}</Alert> : null}
                </Stack>
              </Collapse>

              <Collapse in={isRegisterVerificationStep || isResetVerificationStep} timeout={300}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ pt: 1.4 }}>
                  <Button
                    type="button"
                    disabled={isSubmitting || resendCooldownSeconds > 0}
                    onClick={() => void resendCode()}
                    sx={{ minHeight: 36, color: MUTED_TEXT, textTransform: 'none', fontWeight: 500, '&:hover': { color: INPUT_TEXT, backgroundColor: 'transparent' } }}
                  >
                    {resendCooldownSeconds > 0 ? `Отправить снова через ${formatCooldown(resendCooldownSeconds)}` : 'Отправить код снова'}
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
                    sx={{ minHeight: 36, color: MUTED_TEXT, textTransform: 'none', fontWeight: 500, '&:hover': { color: INPUT_TEXT, backgroundColor: 'transparent' } }}
                  >
                    Изменить данные
                  </Button>
                </Stack>
              </Collapse>

              <Button
                type="submit"
                fullWidth
                disabled={isSubmitBlocked}
                // Inline rather than sx: the theme's MuiButton override sets background-color on
                // the same generated class, and an sx `background` shorthand kept losing to it.
                // An inline declaration outranks any author rule that is not !important.
                style={{
                  background: isSubmitBlocked ? '#23272b' : ACCENT,
                  color: isSubmitBlocked ? '#666d75' : '#161009',
                }}
                sx={{
                  mt: 2.2,
                  minHeight: 50,
                  border: 'none',
                  fontFamily: '"Manrope", sans-serif',
                  fontSize: '1.02rem',
                  fontWeight: 700,
                  textTransform: 'none',
                  transition: 'background-color 320ms ease, color 320ms ease, filter 160ms ease',
                  // One accent, one hue: hover and press change brightness, never colour.
                  '&:hover, &:focus, &.Mui-focusVisible': { filter: 'brightness(1.08)' },
                  '&:active': { filter: 'brightness(0.94)' },
                  // Disabled is a solid muted fill - fading the accent over black looked muddy.
                  '&:disabled': { opacity: 1, filter: 'none' },
                }}
              >
                {isSubmitting ? <CircularProgress size={22} sx={{ color: '#161009' }} /> : submitLabel}
              </Button>

              <Collapse in={shouldShowExternalAuth} timeout={320}>
                <Stack spacing={1.25} sx={{ pt: 1.8 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '13px',
                      fontSize: 11,
                      color: MUTED_TEXT,
                      '&:before, &:after': { content: '""', height: '1px', flex: 1, background: BORDER_COLOR },
                    }}
                  >
                    или продолжить через
                  </Box>
                  {shouldShowGoogle && hasGoogleClientId ? (
                    <GoogleAuthButton
                      disabled={isSubmitting || isExternalAuthSubmitting}
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
                  ) : null}
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '9px' }}>
                    <ProviderAuthButton
                      provider="yandex"
                      label="Яндекс"
                      disabled={isSubmitting || isExternalAuthSubmitting}
                      busy={isYandexSubmitting}
                      onClick={() => void handleYandexAuth()}
                    />
                    <ProviderAuthButton
                      provider="vk"
                      label="VK"
                      disabled={isSubmitting || isExternalAuthSubmitting}
                      busy={vkIDSubmittingProvider === 'vk'}
                      onClick={() => void handleVKIDAuth('vk')}
                    />
                    <ProviderAuthButton
                      provider="mail"
                      label="Mail"
                      disabled={isSubmitting || isExternalAuthSubmitting}
                      busy={vkIDSubmittingProvider === 'mail'}
                      onClick={() => void handleVKIDAuth('mail')}
                    />
                  </Box>
                </Stack>
              </Collapse>

              <Typography sx={{ pt: 2, textAlign: 'center', color: '#d7d7d7', fontSize: '0.88rem', fontWeight: 400 }}>
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
            </Box>
          </Box>

          <Box
            sx={{
              mt: 'auto',
              pb: { xs: '14px', md: '16px' },
              pt: 1.5,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '8px',
              fontSize: 10,
              lineHeight: 1.5,
              color: MUTED_TEXT,
              px: 2,
              textAlign: 'center',
            }}
          >
            <Box component="svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden sx={{ width: 12, height: 12, flexShrink: 0 }}>
              <rect x="5" y="8" width="10" height="9" rx="1" />
              <path d="M7 8V5a3 3 0 0 1 6 0v3" />
            </Box>
            Соединение защищено · Moru не передаёт твои данные третьим лицам
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
