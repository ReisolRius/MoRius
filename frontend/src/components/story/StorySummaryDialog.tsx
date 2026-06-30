import { Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import BaseDialog from '../dialogs/BaseDialog'
import SoulIcon from '../currency/SoulIcon'
import type { AuthUser } from '../../types/auth'
import type { StorySummaryJobPayload, StorySummaryResult } from '../../types/story'
import { getStorySummaryJob, queueStorySummaryJob } from '../../services/storyApi'
import {
  buildStorySummaryBook,
  buildStorySummaryPdf,
  downloadStoryBookPdf,
  sanitizeStoryBookFilename,
  type StoryBookPage,
} from '../../utils/storySummaryBook'

type StorySummaryDialogProps = {
  open: boolean
  onClose: () => void
  token: string
  gameId: number | null
  gameTitle: string
  contextLimitChars: number
  turnCount: number
  onUserUpdate: (user: AuthUser) => void
}

type SummaryStep = 'intro' | 'style' | 'progress' | 'rendering' | 'reader' | 'error'

const SUMMARY_MIN_COST = 100
const SUMMARY_MAX_COST = 500
const SUMMARY_MIN_TURNS = 10
const POLL_INTERVAL_MS = 2500

const STAGE_LABELS: Record<string, string> = {
  queued: 'Готовим всё к работе…',
  preparing: 'Собираем вашу историю…',
  writing: 'Пишем книгу по вашему приключению…',
  illustrating: 'Рисуем иллюстрации к ключевым сценам…',
  completed: 'Книга готова!',
}

function resolveStageLabel(job: StorySummaryJobPayload | null): string {
  if (!job) {
    return STAGE_LABELS.queued
  }
  if (job.stage === 'illustrating' && job.total_images > 0) {
    return `Рисуем иллюстрации — ${Math.min(job.completed_images, job.total_images)} из ${job.total_images}`
  }
  return STAGE_LABELS[job.stage] ?? STAGE_LABELS.queued
}

const accentButtonSx = {
  minHeight: 46,
  px: 2.4,
  borderRadius: '12px',
  textTransform: 'none',
  fontWeight: 900,
  fontSize: '0.96rem',
  color: '#11070A !important',
  background: 'linear-gradient(135deg, color-mix(in srgb, var(--morius-accent) 92%, #fff 8%), var(--morius-accent)) !important',
  boxShadow: '0 16px 34px -18px color-mix(in srgb, var(--morius-accent) 80%, transparent) !important',
  '&:hover': {
    background: 'linear-gradient(135deg, var(--morius-accent), color-mix(in srgb, var(--morius-accent) 80%, #000 20%)) !important',
  },
  '&.Mui-disabled': {
    opacity: 0.55,
    color: '#11070A !important',
  },
} as const

const ghostButtonSx = {
  minHeight: 46,
  px: 2.2,
  borderRadius: '12px',
  textTransform: 'none',
  fontWeight: 800,
  fontSize: '0.94rem',
  color: 'var(--morius-text-secondary) !important',
  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 88%, transparent) !important',
  backgroundColor: 'transparent !important',
  '&:hover': {
    color: 'var(--morius-title-text) !important',
    backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 70%, transparent) !important',
  },
} as const

function SummaryHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Stack spacing={0.6} sx={{ pr: 4 }}>
      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.32rem', fontWeight: 900, lineHeight: 1.18 }}>
        {title}
      </Typography>
      {subtitle ? (
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.92rem', lineHeight: 1.4 }}>
          {subtitle}
        </Typography>
      ) : null}
    </Stack>
  )
}

function InfoNote({ tone, children }: { tone: 'accent' | 'warning'; children: ReactNode }) {
  const isWarning = tone === 'warning'
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.1,
        p: 1.4,
        borderRadius: '14px',
        border: 'var(--morius-border-width) solid',
        borderColor: isWarning
          ? 'color-mix(in srgb, #E0A23A 46%, var(--morius-card-border))'
          : 'color-mix(in srgb, var(--morius-accent) 40%, var(--morius-card-border))',
        backgroundColor: isWarning
          ? 'color-mix(in srgb, #E0A23A 12%, var(--morius-elevated-bg) 88%)'
          : 'color-mix(in srgb, var(--morius-accent) 10%, var(--morius-elevated-bg) 90%)',
      }}
    >
      <Box
        sx={{
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontSize: '0.86rem',
          fontWeight: 900,
          color: isWarning ? '#E0A23A' : 'var(--morius-accent)',
          border: '2px solid currentColor',
        }}
      >
        {isWarning ? '!' : 'i'}
      </Box>
      <Typography component="div" sx={{ color: 'var(--morius-text-primary)', fontSize: '0.9rem', lineHeight: 1.45 }}>
        {children}
      </Typography>
    </Box>
  )
}

export default function StorySummaryDialog({
  open,
  onClose,
  token,
  gameId,
  gameTitle,
  contextLimitChars,
  turnCount,
  onUserUpdate,
}: StorySummaryDialogProps) {
  const [step, setStep] = useState<SummaryStep>('intro')
  const [stylePrompt, setStylePrompt] = useState('')
  const [job, setJob] = useState<StorySummaryJobPayload | null>(null)
  const [result, setResult] = useState<StorySummaryResult | null>(null)
  const [bookPages, setBookPages] = useState<StoryBookPage[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [errorDetail, setErrorDetail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const pollTimeoutRef = useRef<number | null>(null)
  const isMountedRef = useRef(true)
  const activeJobIdRef = useRef<number | null>(null)
  const lastCoinsRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      stopPolling()
    }
  }, [stopPolling])

  const resetState = useCallback(() => {
    stopPolling()
    activeJobIdRef.current = null
    lastCoinsRef.current = null
    setStep('intro')
    setStylePrompt('')
    setJob(null)
    setResult(null)
    setBookPages([])
    setPageIndex(0)
    setErrorDetail('')
    setIsSubmitting(false)
    setIsDownloading(false)
  }, [stopPolling])

  // Reset whenever the dialog is fully closed so a fresh open starts clean.
  useEffect(() => {
    if (!open) {
      const timer = window.setTimeout(() => {
        if (!isMountedRef.current) {
          return
        }
        resetState()
      }, 220)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [open, resetState])

  const beginRendering = useCallback(async (summary: StorySummaryResult) => {
    setResult(summary)
    setStep('rendering')
    try {
      const pages = await buildStorySummaryBook({
        title: summary.title || gameTitle || 'Моя история',
        subtitle: 'Создано в MoRius',
        segments: summary.segments ?? [],
      })
      if (!isMountedRef.current) {
        return
      }
      setBookPages(pages)
      setPageIndex(0)
      setStep('reader')
    } catch (renderError) {
      if (!isMountedRef.current) {
        return
      }
      setErrorDetail(
        renderError instanceof Error ? renderError.message : 'Не удалось собрать книгу для чтения',
      )
      setStep('error')
    }
  }, [gameTitle])

  const applyJobUpdate = useCallback(
    (nextJob: StorySummaryJobPayload) => {
      setJob(nextJob)
      // Only propagate the user when the balance actually changed (charge / refund),
      // to avoid re-rendering the page on every poll tick.
      if (nextJob.user && nextJob.user.coins !== lastCoinsRef.current) {
        lastCoinsRef.current = nextJob.user.coins
        onUserUpdate(nextJob.user)
      }
      if (nextJob.status === 'completed' && nextJob.result) {
        stopPolling()
        void beginRendering(nextJob.result)
        return
      }
      if (nextJob.status === 'failed') {
        stopPolling()
        setErrorDetail(nextJob.error_detail || 'Не удалось подвести итоги. Солы возвращены на баланс.')
        setStep('error')
      }
    },
    [beginRendering, onUserUpdate, stopPolling],
  )

  const scheduleNextPoll = useCallback(
    (jobId: number) => {
      stopPolling()
      pollTimeoutRef.current = window.setTimeout(async () => {
        if (!isMountedRef.current || gameId === null || activeJobIdRef.current !== jobId) {
          return
        }
        try {
          const nextJob = await getStorySummaryJob({ token, gameId, jobId })
          if (!isMountedRef.current || activeJobIdRef.current !== jobId) {
            return
          }
          applyJobUpdate(nextJob)
          if (nextJob.status === 'queued' || nextJob.status === 'running') {
            scheduleNextPoll(jobId)
          }
        } catch {
          // Transient gateway/network errors: keep polling.
          if (isMountedRef.current && activeJobIdRef.current === jobId) {
            scheduleNextPoll(jobId)
          }
        }
      }, POLL_INTERVAL_MS)
    },
    [applyJobUpdate, gameId, stopPolling, token],
  )

  const handleStart = useCallback(async () => {
    if (gameId === null || isSubmitting) {
      return
    }
    setIsSubmitting(true)
    setErrorDetail('')
    try {
      const startedJob = await queueStorySummaryJob({
        token,
        gameId,
        stylePrompt: stylePrompt.trim(),
      })
      if (!isMountedRef.current) {
        return
      }
      activeJobIdRef.current = startedJob.id
      setStep('progress')
      applyJobUpdate(startedJob)
      if (startedJob.status === 'queued' || startedJob.status === 'running') {
        scheduleNextPoll(startedJob.id)
      }
    } catch (startError) {
      if (!isMountedRef.current) {
        return
      }
      setErrorDetail(startError instanceof Error ? startError.message : 'Не удалось запустить подведение итогов')
      setStep('error')
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false)
      }
    }
  }, [applyJobUpdate, gameId, isSubmitting, scheduleNextPoll, stylePrompt, token])

  const handleDownloadPdf = useCallback(async () => {
    if (bookPages.length === 0 || isDownloading) {
      return
    }
    setIsDownloading(true)
    try {
      const blob = buildStorySummaryPdf(bookPages)
      // PDF filename is the game's title, per product requirement.
      const filename = sanitizeStoryBookFilename(gameTitle || result?.title || 'Моя история')
      downloadStoryBookPdf(blob, filename)
    } catch (downloadError) {
      setErrorDetail(downloadError instanceof Error ? downloadError.message : 'Не удалось сохранить PDF')
    } finally {
      if (isMountedRef.current) {
        setIsDownloading(false)
      }
    }
  }, [bookPages, gameTitle, isDownloading, result?.title])

  const goToPage = useCallback(
    (next: number) => {
      setPageIndex((current) => {
        const target = current + next
        if (target < 0 || target >= bookPages.length) {
          return current
        }
        return target
      })
    },
    [bookPages.length],
  )

  useEffect(() => {
    if (step !== 'reader') {
      return undefined
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        goToPage(-1)
      } else if (event.key === 'ArrowRight') {
        goToPage(1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goToPage, step])

  const dialogMaxWidth = step === 'reader' ? 'md' : 'sm'
  const turnsRemaining = Math.max(SUMMARY_MIN_TURNS - turnCount, 0)
  const formattedContextLimit = useMemo(
    () => Math.max(Math.trunc(contextLimitChars), 0).toLocaleString('ru-RU'),
    [contextLimitChars],
  )

  let headerNode: ReactNode = null
  let bodyNode: ReactNode = null

  if (step === 'intro') {
    headerNode = (
      <SummaryHeading
        title="Подвести итоги"
        subtitle="Превратите всё ваше приключение в красивую иллюстрированную книгу"
      />
    )
    bodyNode = (
      <Stack spacing={1.6}>
        <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.96rem', lineHeight: 1.55 }}>
          Мы прочитаем вашу историю, важные и развивающиеся воспоминания, и напишем по ним цельный
          художественный рассказ — словно кто-то наблюдал за вашим приключением и издал по нему книгу.
          К ключевым сценам нейросеть нарисует иллюстрации, а готовый результат можно будет сохранить в PDF.
        </Typography>
        <InfoNote tone="accent">
          Создание книги — большая работа: она может занять{' '}
          <Box component="span" sx={{ fontWeight: 900, color: 'var(--morius-accent)', whiteSpace: 'nowrap' }}>
            от {SUMMARY_MIN_COST} до {SUMMARY_MAX_COST}
          </Box>{' '}
          <SoulIcon size={14} sx={{ color: 'var(--morius-accent)', verticalAlign: '-2px' }} /> солов в зависимости от
          количества иллюстраций. Мы зарезервируем {SUMMARY_MAX_COST} и вернём неиспользованное после готовности.
        </InfoNote>
        <InfoNote tone="warning">
          В рассказ попадёт только то, что помещается в вашу контекстную память
          ({formattedContextLimit} токенов из правого меню). Если история длиннее — самые ранние события,
          которые уже не помещаются в память, в книгу не войдут.
        </InfoNote>
      </Stack>
    )
  } else if (step === 'style') {
    headerNode = (
      <SummaryHeading title="Стиль иллюстраций" subtitle="Опишите, какими вы хотите видеть картинки" />
    )
    bodyNode = (
      <Stack spacing={1.5}>
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.92rem', lineHeight: 1.5 }}>
          Например: «тёмное мрачное фэнтези, масляная живопись», «аниме, мягкие пастельные тона»,
          «реалистичная цифровая иллюстрация, кинематографичный свет». Этот стиль применится ко всем картинкам.
        </Typography>
        <TextField
          autoFocus
          multiline
          minRows={3}
          maxRows={6}
          fullWidth
          value={stylePrompt}
          onChange={(event) => setStylePrompt(event.target.value.slice(0, 600))}
          placeholder="Опишите желаемый стиль картинок…"
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '14px',
              backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
              color: 'var(--morius-text-primary)',
              fontSize: '0.95rem',
            },
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
            },
            '& .Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: 'var(--morius-accent) !important',
            },
          }}
        />
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem' }}>
          Можно оставить поле пустым — тогда стиль подберётся автоматически.
        </Typography>
      </Stack>
    )
  } else if (step === 'progress') {
    headerNode = null
    bodyNode = (
      <Stack spacing={2.4} alignItems="center" sx={{ py: 3, textAlign: 'center' }}>
        <Box sx={{ position: 'relative', width: 120, height: 120, display: 'grid', placeItems: 'center' }}>
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background:
                'conic-gradient(from 0deg, transparent, color-mix(in srgb, var(--morius-accent) 70%, transparent), transparent)',
              animation: 'morius-summary-spin 2.4s linear infinite',
              '@keyframes morius-summary-spin': {
                to: { transform: 'rotate(360deg)' },
              },
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              inset: 8,
              borderRadius: '50%',
              backgroundColor: 'var(--morius-dialog-bg)',
              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 36%, var(--morius-card-border))',
            }}
          />
          <Box
            component="span"
            sx={{
              position: 'relative',
              fontSize: '2.4rem',
              animation: 'morius-summary-pulse 1.8s ease-in-out infinite',
              '@keyframes morius-summary-pulse': {
                '0%, 100%': { opacity: 0.55, transform: 'scale(0.94)' },
                '50%': { opacity: 1, transform: 'scale(1.06)' },
              },
            }}
          >
            📖
          </Box>
        </Box>
        <Stack spacing={0.8} alignItems="center">
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.12rem', fontWeight: 900 }}>
            {resolveStageLabel(job)}
          </Typography>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', lineHeight: 1.45, maxWidth: 360 }}>
            Это может занять до пары минут. Не закрывайте окно — мы соберём вашу книгу и покажем её здесь.
          </Typography>
        </Stack>
        {job && job.stage === 'illustrating' && job.total_images > 0 ? (
          <Box sx={{ width: '100%', maxWidth: 320 }}>
            <Box
              sx={{
                height: 8,
                borderRadius: 999,
                overflow: 'hidden',
                backgroundColor: 'color-mix(in srgb, var(--morius-card-border) 70%, transparent)',
              }}
            >
              <Box
                sx={{
                  height: '100%',
                  borderRadius: 999,
                  width: `${Math.round((Math.min(job.completed_images, job.total_images) / job.total_images) * 100)}%`,
                  background: 'linear-gradient(90deg, color-mix(in srgb, var(--morius-accent) 70%, #fff 30%), var(--morius-accent))',
                  transition: 'width 360ms ease',
                }}
              />
            </Box>
          </Box>
        ) : null}
      </Stack>
    )
  } else if (step === 'rendering') {
    headerNode = null
    bodyNode = (
      <Stack spacing={2} alignItems="center" sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress sx={{ color: 'var(--morius-accent)' }} />
        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.04rem', fontWeight: 800 }}>
          Верстаем страницы вашей книги…
        </Typography>
      </Stack>
    )
  } else if (step === 'reader') {
    const currentPage = bookPages[pageIndex]
    headerNode = (
      <SummaryHeading
        title={result?.title || gameTitle || 'Моя история'}
        subtitle={result?.truncated ? 'Часть самых ранних событий не вошла из-за лимита памяти' : undefined}
      />
    )
    bodyNode = (
      <Stack spacing={1.6}>
        <Box
          sx={{
            borderRadius: '16px',
            overflow: 'hidden',
            border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 86%, transparent)',
            backgroundColor: '#0B0B0F',
            display: 'grid',
            placeItems: 'center',
            maxHeight: '64vh',
          }}
        >
          {currentPage ? (
            <Box
              component="img"
              src={currentPage.dataUrl}
              alt={`Страница ${pageIndex + 1}`}
              sx={{ width: '100%', height: 'auto', maxHeight: '64vh', objectFit: 'contain', display: 'block' }}
            />
          ) : null}
        </Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Button onClick={() => goToPage(-1)} disabled={pageIndex <= 0} sx={ghostButtonSx}>
            ← Назад
          </Button>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', fontWeight: 800 }}>
            Страница {pageIndex + 1} из {bookPages.length}
          </Typography>
          <Button onClick={() => goToPage(1)} disabled={pageIndex >= bookPages.length - 1} sx={ghostButtonSx}>
            Вперёд →
          </Button>
        </Stack>
      </Stack>
    )
  } else if (step === 'error') {
    headerNode = <SummaryHeading title="Что-то пошло не так" />
    bodyNode = (
      <Stack spacing={1.4}>
        <InfoNote tone="warning">
          {errorDetail || 'Не удалось подвести итоги. Если списались солы за неудавшуюся работу, они возвращены.'}
        </InfoNote>
      </Stack>
    )
  }

  const actionsNode = (() => {
    if (step === 'intro') {
      const blocked = gameId === null || turnsRemaining > 0
      return (
        <Stack direction="row" spacing={1} sx={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onClose} sx={ghostButtonSx}>
            Отмена
          </Button>
          <Button onClick={() => setStep('style')} disabled={blocked} sx={accentButtonSx}>
            {turnsRemaining > 0 ? `Ещё ${turnsRemaining} ходов` : 'Продолжить'}
          </Button>
        </Stack>
      )
    }
    if (step === 'style') {
      return (
        <Stack direction="row" spacing={1} sx={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={() => setStep('intro')} disabled={isSubmitting} sx={ghostButtonSx}>
            Назад
          </Button>
          <Button onClick={() => void handleStart()} disabled={isSubmitting || gameId === null} sx={accentButtonSx}>
            {isSubmitting ? <CircularProgress size={20} sx={{ color: '#11070A' }} /> : 'Создать книгу'}
          </Button>
        </Stack>
      )
    }
    if (step === 'reader') {
      return (
        <Stack direction="row" spacing={1} sx={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onClose} sx={ghostButtonSx}>
            Закрыть
          </Button>
          <Button onClick={() => void handleDownloadPdf()} disabled={isDownloading} sx={accentButtonSx}>
            {isDownloading ? <CircularProgress size={20} sx={{ color: '#11070A' }} /> : 'Скачать PDF'}
          </Button>
        </Stack>
      )
    }
    if (step === 'error') {
      return (
        <Stack direction="row" spacing={1} sx={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onClose} sx={ghostButtonSx}>
            Закрыть
          </Button>
          <Button onClick={() => setStep('intro')} sx={accentButtonSx}>
            Попробовать снова
          </Button>
        </Stack>
      )
    }
    return null
  })()

  const lockBackdrop = step === 'progress' || step === 'rendering'

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      maxWidth={dialogMaxWidth}
      header={headerNode}
      actions={actionsNode ?? undefined}
      showCloseButton
      disableBackdropClose={lockBackdrop}
      protectTextInputClose={false}
    >
      {bodyNode}
    </BaseDialog>
  )
}
