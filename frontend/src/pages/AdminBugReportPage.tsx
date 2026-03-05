import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import {
  closeBugReportForAdmin,
  getBugReportForAdmin,
  type AdminBugReportDetail,
} from '../services/authApi'
import type {
  StoryGamePayload,
  StoryMemoryBlock,
  StoryMessage,
  StoryPlotCardEvent,
  StoryTurnImage,
  StoryWorldCardEvent,
} from '../types/story'

type AdminBugReportPageProps = {
  authToken: string
  reportId: number
  onNavigate: (path: string) => void
}

function formatDateLabel(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value || '—'
  }
  return parsed.toLocaleString('ru-RU')
}

function normalizeSnapshotArray<T>(value: T[] | null | undefined): T[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
}

function SnapshotSection({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <Box
      sx={{
        borderRadius: '14px',
        border: 'var(--morius-border-width) solid var(--morius-card-border)',
        backgroundColor: 'var(--morius-card-bg)',
        p: 1.3,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.9 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: 'var(--morius-title-text)' }}>{title}</Typography>
        {typeof count === 'number' ? (
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem' }}>{count}</Typography>
        ) : null}
      </Stack>
      {children}
    </Box>
  )
}

function StoryMessageCard({ message }: { message: StoryMessage }) {
  const isUser = message.role === 'user'
  return (
    <Box
      sx={{
        borderRadius: '12px',
        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
        backgroundColor: isUser
          ? 'color-mix(in srgb, var(--morius-elevated-bg) 90%, transparent)'
          : 'color-mix(in srgb, var(--morius-card-bg) 96%, transparent)',
        px: 1,
        py: 0.9,
      }}
    >
      <Typography sx={{ fontSize: '0.78rem', color: 'var(--morius-text-secondary)', mb: 0.45 }}>
        {isUser ? 'User' : 'Assistant'} • #{message.id} • {formatDateLabel(message.created_at)}
      </Typography>
      <Typography sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.42, color: 'var(--morius-text-primary)' }}>
        {message.content}
      </Typography>
    </Box>
  )
}

function MemoryCard({ memory }: { memory: StoryMemoryBlock }) {
  return (
    <Box
      sx={{
        borderRadius: '12px',
        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
        backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
        px: 1,
        py: 0.9,
      }}
    >
      <Typography sx={{ fontSize: '0.78rem', color: 'var(--morius-text-secondary)', mb: 0.45 }}>
        Layer: {memory.layer} • #{memory.id} • tokens: {memory.token_count}
      </Typography>
      <Typography sx={{ fontWeight: 700, color: 'var(--morius-title-text)', mb: 0.4 }}>{memory.title}</Typography>
      <Typography sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.42, color: 'var(--morius-text-primary)' }}>
        {memory.content}
      </Typography>
    </Box>
  )
}

function EventCard({
  event,
  type,
}: {
  event: StoryPlotCardEvent | StoryWorldCardEvent
  type: 'plot' | 'world'
}) {
  const eventId = typeof event.id === 'number' ? event.id : 0
  const eventAction = typeof event.action === 'string' ? event.action : 'unknown'
  const changedText = typeof event.changed_text === 'string' ? event.changed_text : ''

  return (
    <Box
      sx={{
        borderRadius: '12px',
        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
        backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 96%, transparent)',
        px: 1,
        py: 0.9,
      }}
    >
      <Typography sx={{ fontSize: '0.78rem', color: 'var(--morius-text-secondary)', mb: 0.4 }}>
        {type} • #{eventId} • action: {eventAction} • {formatDateLabel(event.created_at)}
      </Typography>
      <Typography sx={{ fontWeight: 700, color: 'var(--morius-title-text)', mb: 0.35 }}>
        {'title' in event ? event.title : ''}
      </Typography>
      <Typography sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.42, color: 'var(--morius-text-primary)', mb: 0.6 }}>
        {changedText || 'No changed text'}
      </Typography>
      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', mb: 0.25 }}>Before snapshot</Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 0.8,
          borderRadius: '10px',
          backgroundColor: 'color-mix(in srgb, var(--morius-app-base) 92%, transparent)',
          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 74%, transparent)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: 'var(--morius-text-secondary)',
          fontFamily: '"JetBrains Mono", "Consolas", monospace',
          fontSize: '0.73rem',
          lineHeight: 1.45,
        }}
      >
        {JSON.stringify((event as { before_snapshot?: unknown }).before_snapshot ?? null, null, 2)}
      </Box>
      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', mb: 0.25, mt: 0.7 }}>After snapshot</Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 0.8,
          borderRadius: '10px',
          backgroundColor: 'color-mix(in srgb, var(--morius-app-base) 92%, transparent)',
          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 74%, transparent)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: 'var(--morius-text-secondary)',
          fontFamily: '"JetBrains Mono", "Consolas", monospace',
          fontSize: '0.73rem',
          lineHeight: 1.45,
        }}
      >
        {JSON.stringify((event as { after_snapshot?: unknown }).after_snapshot ?? null, null, 2)}
      </Box>
    </Box>
  )
}

function AdminBugReportPage({ authToken, reportId, onNavigate }: AdminBugReportPageProps) {
  const [report, setReport] = useState<AdminBugReportDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isClosing, setIsClosing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const loadReport = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')
    try {
      const response = await getBugReportForAdmin({
        token: authToken,
        report_id: reportId,
      })
      setReport(response)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить баг-репорт'
      setErrorMessage(detail)
      setReport(null)
    } finally {
      setIsLoading(false)
    }
  }, [authToken, reportId])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  const snapshot: StoryGamePayload | null = report?.snapshot ?? null
  const messages = normalizeSnapshotArray(snapshot?.messages)
  const memoryBlocks = normalizeSnapshotArray(snapshot?.memory_blocks)
  const instructionCards = normalizeSnapshotArray(snapshot?.instruction_cards)
  const plotCards = normalizeSnapshotArray(snapshot?.plot_cards)
  const worldCards = normalizeSnapshotArray(snapshot?.world_cards)
  const plotEvents = normalizeSnapshotArray(snapshot?.plot_card_events)
  const worldEvents = normalizeSnapshotArray(snapshot?.world_card_events)
  const turnImages = normalizeSnapshotArray(snapshot?.turn_images)

  const memoryLayerStats = useMemo(() => {
    const counts: Record<string, number> = { raw: 0, compressed: 0, super: 0, key: 0 }
    memoryBlocks.forEach((block) => {
      const key = typeof block.layer === 'string' ? block.layer : 'unknown'
      counts[key] = (counts[key] ?? 0) + 1
    })
    return counts
  }, [memoryBlocks])

  const handleLeaveSnapshot = () => {
    onNavigate('/profile')
  }

  const handleCloseReport = useCallback(async () => {
    if (!report || isClosing) {
      return
    }
    setIsClosing(true)
    setErrorMessage('')
    try {
      await closeBugReportForAdmin({
        token: authToken,
        report_id: report.id,
      })
      onNavigate('/profile')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось закрыть баг-репорт'
      setErrorMessage(detail)
    } finally {
      setIsClosing(false)
    }
  }, [authToken, isClosing, onNavigate, report])

  if (isLoading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--morius-app-bg)' }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'var(--morius-app-bg)',
        color: 'var(--morius-text-primary)',
        px: { xs: 1.1, sm: 2.2 },
        py: { xs: 1.1, sm: 1.8 },
      }}
    >
      <Stack spacing={1.2} sx={{ maxWidth: 1240, mx: 'auto' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
          <Stack spacing={0.2}>
            <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.14rem', sm: '1.32rem' } }}>
              {report?.title || `Bug report #${reportId}`}
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.86rem' }}>
              Frozen snapshot. This page is not connected to the live game.
            </Typography>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
            <Button onClick={handleLeaveSnapshot} sx={{ color: 'var(--morius-text-secondary)' }}>
              Покинуть мир
            </Button>
            <Button
              onClick={() => void handleCloseReport()}
              disabled={!report || isClosing}
              sx={{
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                color: 'var(--morius-text-primary)',
                backgroundColor: 'rgba(192, 91, 91, 0.38)',
                '&:hover': {
                  backgroundColor: 'rgba(199, 102, 102, 0.5)',
                },
              }}
            >
              {isClosing ? <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} /> : 'Закрыть баг репорт'}
            </Button>
          </Stack>
        </Stack>

        {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

        {!report ? (
          <Alert severity="warning">
            Баг-репорт не найден или уже закрыт.
            <Box sx={{ mt: 0.8 }}>
              <Button size="small" onClick={() => void loadReport()}>
                Повторить
              </Button>
            </Box>
          </Alert>
        ) : (
          <Stack spacing={1.1}>
            <SnapshotSection title="Report Metadata">
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', mb: 0.35 }}>
                Report ID: #{report.id}
              </Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', mb: 0.35 }}>
                Source game: #{report.source_game_id} • {report.source_game_title}
              </Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', mb: 0.35 }}>
                Reporter: {report.reporter_name} • user #{report.reporter_user_id}
              </Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>
                Created: {formatDateLabel(report.created_at)}
              </Typography>
              <Divider sx={{ my: 1 }} />
              <Typography sx={{ color: 'var(--morius-text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.42 }}>
                {report.description}
              </Typography>
            </SnapshotSection>

            <SnapshotSection title="Game Snapshot">
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>
                Game ID: #{snapshot?.game?.id ?? 0}
              </Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>
                Title: {snapshot?.game?.title || '—'}
              </Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>
                Visibility: {snapshot?.game?.visibility || '—'} • age: {snapshot?.game?.age_rating || '—'}
              </Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>
                Can redo assistant step: {snapshot?.can_redo_assistant_step ? 'yes' : 'no'}
              </Typography>
            </SnapshotSection>

            <SnapshotSection title="Messages" count={messages.length}>
              <Stack spacing={0.8}>
                {messages.map((message) => (
                  <StoryMessageCard key={message.id} message={message} />
                ))}
                {messages.length === 0 ? <Typography sx={{ color: 'var(--morius-text-secondary)' }}>No messages</Typography> : null}
              </Stack>
            </SnapshotSection>

            <SnapshotSection title="Memory Blocks" count={memoryBlocks.length}>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', mb: 0.8 }}>
                raw: {memoryLayerStats.raw ?? 0} • compressed: {memoryLayerStats.compressed ?? 0} • super: {memoryLayerStats.super ?? 0} • key:{' '}
                {memoryLayerStats.key ?? 0}
              </Typography>
              <Stack spacing={0.8}>
                {memoryBlocks.map((memory) => (
                  <MemoryCard key={memory.id} memory={memory} />
                ))}
                {memoryBlocks.length === 0 ? (
                  <Typography sx={{ color: 'var(--morius-text-secondary)' }}>No memory blocks</Typography>
                ) : null}
              </Stack>
            </SnapshotSection>

            <SnapshotSection title="Instruction Cards" count={instructionCards.length}>
              <Stack spacing={0.8}>
                {instructionCards.map((card) => (
                  <Box
                    key={card.id}
                    sx={{
                      borderRadius: '12px',
                      border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
                      px: 1,
                      py: 0.9,
                    }}
                  >
                    <Typography sx={{ fontWeight: 700, color: 'var(--morius-title-text)', mb: 0.4 }}>{card.title}</Typography>
                    <Typography sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.42, color: 'var(--morius-text-primary)' }}>
                      {card.content}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </SnapshotSection>

            <SnapshotSection title="Plot Cards" count={plotCards.length}>
              <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', color: 'var(--morius-text-secondary)' }}>
                {JSON.stringify(plotCards, null, 2)}
              </Box>
            </SnapshotSection>

            <SnapshotSection title="World Cards" count={worldCards.length}>
              <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', color: 'var(--morius-text-secondary)' }}>
                {JSON.stringify(worldCards, null, 2)}
              </Box>
            </SnapshotSection>

            <SnapshotSection title="Plot Events" count={plotEvents.length}>
              <Stack spacing={0.8}>
                {plotEvents.map((event) => (
                  <EventCard key={event.id} event={event} type="plot" />
                ))}
              </Stack>
            </SnapshotSection>

            <SnapshotSection title="World Events" count={worldEvents.length}>
              <Stack spacing={0.8}>
                {worldEvents.map((event) => (
                  <EventCard key={event.id} event={event} type="world" />
                ))}
              </Stack>
            </SnapshotSection>

            <SnapshotSection title="Turn Images" count={turnImages.length}>
              <Stack spacing={0.8}>
                {turnImages.map((turnImage: StoryTurnImage) => (
                  <Box
                    key={turnImage.id}
                    sx={{
                      borderRadius: '12px',
                      border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 84%, transparent)',
                      backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 96%, transparent)',
                      px: 1,
                      py: 0.9,
                    }}
                  >
                    <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', mb: 0.45 }}>
                      #{turnImage.id} • assistant #{turnImage.assistant_message_id} • {turnImage.model}
                    </Typography>
                    <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', whiteSpace: 'pre-wrap', mb: 0.65 }}>
                      {turnImage.prompt}
                    </Typography>
                    {turnImage.image_data_url || turnImage.image_url ? (
                      <Box
                        component="img"
                        src={turnImage.image_data_url || turnImage.image_url || ''}
                        alt=""
                        sx={{
                          width: '100%',
                          maxWidth: 440,
                          borderRadius: '10px',
                          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 82%, transparent)',
                        }}
                      />
                    ) : (
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem' }}>No image data</Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            </SnapshotSection>

            <SnapshotSection title="Raw Snapshot JSON">
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1,
                  borderRadius: '12px',
                  backgroundColor: 'color-mix(in srgb, var(--morius-app-base) 92%, transparent)',
                  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 74%, transparent)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--morius-text-secondary)',
                  fontFamily: '"JetBrains Mono", "Consolas", monospace',
                  fontSize: '0.73rem',
                  lineHeight: 1.45,
                }}
              >
                {JSON.stringify(snapshot ?? {}, null, 2)}
              </Box>
            </SnapshotSection>
          </Stack>
        )}
      </Stack>
    </Box>
  )
}

export default AdminBugReportPage
