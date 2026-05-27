import { useCallback, useEffect, useState } from 'react'
import { Box, LinearProgress, Stack, SvgIcon, Typography } from '@mui/material'

import BaseDialog from './dialogs/BaseDialog'
import { buildApiUrl } from '../services/httpClient'

type AppDownloadDialogProps = {
  open: boolean
  onClose: () => void
}

type DownloadState = 'idle' | 'downloading' | 'finished' | 'error'

const APK_DOWNLOAD_PATH = '/api/downloads/android/morius-ai.apk'
const APK_FILENAME = 'morius-ai.apk'
const APK_MEDIA_TYPE = 'application/vnd.android.package-archive'

function AndroidDownloadIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 30, height: 30 }}>
      <path
        d="M7.2 9.4c0-1.04.37-1.93.98-2.62L6.86 5.46a.72.72 0 0 1 1.02-1.02l1.42 1.42A5.3 5.3 0 0 1 12 5.18c.98 0 1.9.25 2.7.68l1.42-1.42a.72.72 0 1 1 1.02 1.02l-1.32 1.32c.61.69.98 1.58.98 2.62v.18H7.2V9.4Zm2.35-1.1a.68.68 0 1 0 0-1.36.68.68 0 0 0 0 1.36Zm4.9 0a.68.68 0 1 0 0-1.36.68.68 0 0 0 0 1.36ZM6.9 10.9h10.2v5.7c0 .88-.72 1.6-1.6 1.6h-.6v1.45a.95.95 0 1 1-1.9 0V18.2h-2v1.45a.95.95 0 1 1-1.9 0V18.2h-.6c-.88 0-1.6-.72-1.6-1.6v-5.7Zm-2.4.25c.53 0 .95.42.95.95v3.9a.95.95 0 1 1-1.9 0v-3.9c0-.53.42-.95.95-.95Zm15 0c.53 0 .95.42.95.95v3.9a.95.95 0 1 1-1.9 0v-3.9c0-.53.42-.95.95-.95Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function DownloadArrowIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 22, height: 22 }}>
      <path
        d="M12 3.5c.55 0 1 .45 1 1v8.08l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4.5c0-.55.45-1 1-1Zm-6.5 13c.55 0 1 .45 1 1v1h11v-1a1 1 0 1 1 2 0v2c0 .55-.45 1-1 1h-13c-.55 0-1-.45-1-1v-2c0-.55.45-1 1-1Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function triggerBrowserDownload(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = APK_FILENAME
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return 'Не удалось скачать APK. Попробуйте еще раз.'
}

export default function AppDownloadDialog({ open, onClose }: AppDownloadDialogProps) {
  const [downloadState, setDownloadState] = useState<DownloadState>('idle')
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    if (!open) {
      return
    }
    setDownloadState('idle')
    setDownloadProgress(0)
    setDownloadError('')
  }, [open])

  const handleClose = () => {
    if (downloadState === 'downloading') {
      return
    }
    onClose()
  }

  const handleDownload = useCallback(async () => {
    if (downloadState === 'downloading') {
      return
    }

    setDownloadState('downloading')
    setDownloadProgress(0)
    setDownloadError('')

    try {
      const response = await fetch(buildApiUrl(APK_DOWNLOAD_PATH), { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Не удалось получить APK с сервера (HTTP ${response.status}).`)
      }

      const contentType = response.headers.get('Content-Type') || APK_MEDIA_TYPE
      const totalBytes = Number(response.headers.get('Content-Length') || '')
      const hasKnownSize = Number.isFinite(totalBytes) && totalBytes > 0

      let apkBlob: Blob
      if (response.body) {
        const reader = response.body.getReader()
        const chunks: BlobPart[] = []
        let receivedBytes = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }
          if (!value) {
            continue
          }
          chunks.push(value as BlobPart)
          receivedBytes += value.byteLength
          if (hasKnownSize) {
            setDownloadProgress(Math.min(99, Math.max(4, Math.round((receivedBytes / totalBytes) * 100))))
          }
        }

        apkBlob = new Blob(chunks, { type: contentType })
      } else {
        apkBlob = await response.blob()
      }

      setDownloadProgress(100)
      triggerBrowserDownload(apkBlob)
      setDownloadState('finished')
    } catch (error) {
      setDownloadError(getErrorMessage(error))
      setDownloadProgress(0)
      setDownloadState('error')
    }
  }, [downloadState])

  const isDownloading = downloadState === 'downloading'
  const isFinished = downloadState === 'finished'
  const progressLabel = isDownloading
    ? downloadProgress > 0
      ? `${downloadProgress}%`
      : 'Подготовка файла...'
    : isFinished
      ? 'Файл готов'
      : 'Около 67 МБ'

  return (
    <BaseDialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      disableBackdropClose={isDownloading}
      header={
        <Stack spacing={0.55}>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.2rem', fontWeight: 900 }}>
            Скачать приложение
          </Typography>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', lineHeight: 1.45 }}>
            Сейчас доступна только Android-версия MoRius.
          </Typography>
        </Stack>
      }
      paperSx={{
        borderRadius: '14px',
        border: 'var(--morius-border-width) solid var(--morius-card-border)',
        background: 'var(--morius-card-bg)',
        animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      contentSx={{ px: { xs: 1.2, sm: 2 }, pb: { xs: 1.2, sm: 1.8 } }}
      actions={null}
    >
      <Stack spacing={1.25}>
        <Box
          sx={{
            minHeight: 154,
            borderRadius: '12px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent), var(--morius-card-bg))',
            display: 'grid',
            placeItems: 'center',
            position: 'relative',
            overflow: 'hidden',
            '@keyframes morius-download-device': {
              '0%, 100%': { transform: 'translateY(0)' },
              '50%': { transform: 'translateY(-5px)' },
            },
            '@keyframes morius-download-arrow': {
              '0%': { transform: 'translateY(-7px)', opacity: 0 },
              '38%': { opacity: 1 },
              '100%': { transform: 'translateY(12px)', opacity: 0 },
            },
          }}
        >
          <Box
            sx={{
              width: 82,
              height: 118,
              borderRadius: '18px',
              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 78%, var(--morius-accent) 22%)',
              backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, transparent)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--morius-accent)',
              boxShadow: '0 18px 34px rgba(0, 0, 0, 0.28)',
              animation: isDownloading ? 'morius-download-device 1.4s ease-in-out infinite' : 'none',
            }}
          >
            <AndroidDownloadIcon />
          </Box>
          <Box
            sx={{
              position: 'absolute',
              top: 24,
              color: 'var(--morius-title-text)',
              opacity: isDownloading ? 1 : 0.84,
              animation: isDownloading ? 'morius-download-arrow 1.1s ease-in-out infinite' : 'none',
            }}
          >
            <DownloadArrowIcon />
          </Box>
        </Box>

        <Stack spacing={0.65}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', fontWeight: 800 }}>
              {APK_FILENAME}
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', fontWeight: 700 }}>
              {progressLabel}
            </Typography>
          </Stack>
          <LinearProgress
            variant={isDownloading && downloadProgress <= 0 ? 'indeterminate' : 'determinate'}
            value={isDownloading || isFinished ? downloadProgress : 0}
            sx={{
              height: 8,
              borderRadius: '999px',
              backgroundColor: 'color-mix(in srgb, var(--morius-card-border) 54%, transparent)',
              '& .MuiLinearProgress-bar': {
                borderRadius: '999px',
                backgroundColor: 'var(--morius-accent)',
              },
            }}
          />
        </Stack>

        <Box
          sx={{
            borderRadius: '10px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            backgroundColor: 'var(--morius-elevated-bg)',
            px: 1.15,
            py: 1,
          }}
        >
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.9rem', fontWeight: 800, mb: 0.45 }}>
            Как установить
          </Typography>
          <Stack spacing={0.45}>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem', lineHeight: 1.45 }}>
              1. Скачайте APK и откройте файл на Android-устройстве.
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem', lineHeight: 1.45 }}>
              2. Если Android попросит разрешить установку из браузера, разрешите ее в настройках.
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem', lineHeight: 1.45 }}>
              3. При предупреждении Play Защиты нажмите «Установить без проверки».
            </Typography>
          </Stack>
        </Box>

        {downloadError ? (
          <Typography sx={{ color: '#ff8f8f', fontSize: '0.86rem', lineHeight: 1.4 }}>{downloadError}</Typography>
        ) : null}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} justifyContent="flex-end">
          <Box
            component="button"
            type="button"
            onClick={handleClose}
            disabled={isDownloading}
            sx={{
              minHeight: 42,
              px: 1.5,
              borderRadius: '10px',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--morius-text-secondary)',
              font: 'inherit',
              fontWeight: 800,
              cursor: isDownloading ? 'default' : 'pointer',
              opacity: isDownloading ? 0.52 : 1,
              '&:hover': {
                color: isDownloading ? 'var(--morius-text-secondary)' : 'var(--morius-title-text)',
              },
            }}
          >
            Закрыть
          </Box>
          <Box
            component="button"
            type="button"
            onClick={handleDownload}
            disabled={isDownloading}
            sx={{
              minHeight: 42,
              px: 1.65,
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-accent)',
              color: 'var(--morius-on-accent, #091016)',
              font: 'inherit',
              fontWeight: 900,
              cursor: isDownloading ? 'default' : 'pointer',
              opacity: isDownloading ? 0.72 : 1,
              transition: 'transform 160ms ease, opacity 160ms ease',
              '&:hover': {
                transform: isDownloading ? 'none' : 'translateY(-1px)',
              },
            }}
          >
            {isDownloading ? 'Скачиваем...' : 'Скачать для Android'}
          </Box>
        </Stack>
      </Stack>
    </BaseDialog>
  )
}
