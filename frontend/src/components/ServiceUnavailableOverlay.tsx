import { useEffect, useRef, useState } from 'react'
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import { buildApiUrl } from '../services/httpClient'
import { SERVICE_UNAVAILABLE_EVENT } from '../utils/serviceAvailability'

const RETRY_INTERVAL_MS = 12_000
const MAX_AUTO_RELOAD_WAIT_MS = 300_000

export function ServiceUnavailableOverlay() {
  const [visible, setVisible] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(RETRY_INTERVAL_MS / 1000)
  const [checking, setChecking] = useState(false)

  const activeRef = useRef(false)
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const checkingRef = useRef(false)

  function stopTimers() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
  }

  function startCountdown() {
    stopTimers()
    checkingRef.current = false
    setChecking(false)
    setSecondsLeft(RETRY_INTERVAL_MS / 1000)

    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)

    timerRef.current = setTimeout(() => {
      if (activeRef.current) doCheck()
    }, RETRY_INTERVAL_MS)
  }

  async function doCheck() {
    if (checkingRef.current) return
    checkingRef.current = true
    stopTimers()
    setChecking(true)
    try {
      const res = await fetch(buildApiUrl('/api/health'), { cache: 'no-store' })
      if (res.ok) {
        window.location.reload()
        return
      }
    } catch {
      // still unavailable
    }
    if (!activeRef.current) return
    checkingRef.current = false
    if (Date.now() - startedAtRef.current < MAX_AUTO_RELOAD_WAIT_MS) {
      startCountdown()
    } else {
      setChecking(false)
    }
  }

  useEffect(() => {
    const handleUnavailable = () => {
      if (activeRef.current) return
      activeRef.current = true
      startedAtRef.current = Date.now()
      setVisible(true)
      startCountdown()
    }
    window.addEventListener(SERVICE_UNAVAILABLE_EVENT, handleUnavailable)
    return () => window.removeEventListener(SERVICE_UNAVAILABLE_EVENT, handleUnavailable)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      activeRef.current = false
      stopTimers()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!visible) return null

  const progress = checking
    ? 100
    : ((RETRY_INTERVAL_MS / 1000 - secondsLeft) / (RETRY_INTERVAL_MS / 1000)) * 100

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(8, 12, 22, 0.88)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <Stack
        alignItems="center"
        spacing={3}
        sx={{
          maxWidth: 380,
          width: '100%',
          mx: 2,
          p: 4,
          borderRadius: 3,
          background: 'color-mix(in srgb, var(--morius-card-bg) 95%, var(--morius-accent))',
          border: '1px solid color-mix(in srgb, var(--morius-accent) 22%, transparent)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: 'color-mix(in srgb, var(--morius-accent) 16%, transparent)',
            fontSize: 32,
            lineHeight: 1,
          }}
        >
          {checking ? (
            <CircularProgress size={32} sx={{ color: 'var(--morius-accent)' }} />
          ) : (
            '🔄'
          )}
        </Box>

        <Stack spacing={1} alignItems="center">
          <Typography sx={{ fontSize: '1.18rem', fontWeight: 700, color: 'var(--morius-text-primary)' }}>
            Загружается обновление
          </Typography>
          <Typography sx={{ fontSize: '0.88rem', color: 'var(--morius-text-secondary)', lineHeight: 1.6 }}>
            Сервер перезапускается. Обычно это занимает&nbsp;1–2 минуты — сайт откроется автоматически.
          </Typography>
        </Stack>

        <Box sx={{ width: '100%' }}>
          <Box
            sx={{
              width: '100%',
              height: 2,
              borderRadius: 1,
              backgroundColor: 'color-mix(in srgb, var(--morius-accent) 18%, transparent)',
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                height: '100%',
                borderRadius: 1,
                backgroundColor: 'var(--morius-accent)',
                width: `${progress}%`,
                transition: checking ? 'width 0.4s ease' : 'width 1s linear',
              }}
            />
          </Box>
          <Typography sx={{ fontSize: '0.78rem', color: 'var(--morius-text-secondary)', opacity: 0.65, mt: 1 }}>
            {checking ? 'Проверяем доступность...' : `Повтор через ${secondsLeft} сек`}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.5}>
          <Button
            variant="outlined"
            size="small"
            disabled={checking}
            onClick={() => doCheck()}
            sx={{
              borderColor: 'color-mix(in srgb, var(--morius-accent) 50%, transparent)',
              color: 'var(--morius-accent)',
              fontSize: '0.8rem',
              '&:hover': {
                borderColor: 'var(--morius-accent)',
                backgroundColor: 'color-mix(in srgb, var(--morius-accent) 8%, transparent)',
              },
            }}
          >
            Проверить сейчас
          </Button>
          <Button
            variant="text"
            size="small"
            onClick={() => window.location.reload()}
            sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem' }}
          >
            Перезагрузить
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
