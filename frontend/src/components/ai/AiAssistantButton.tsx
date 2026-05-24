import { useEffect, useState } from 'react'
import { Box, IconButton, Tooltip } from '@mui/material'
import aiIconMarkup from '../../assets/icons/ai.svg?raw'
import { getAiAssistantSettings } from '../../services/aiAssistantApi'
import type { AuthUser } from '../../types/auth'
import ThemedSvgIcon from '../icons/ThemedSvgIcon'

export const AI_ASSISTANT_OPEN_EVENT = 'morius-ai-assistant-open'

type AiAssistantButtonProps = {
  user: AuthUser
  authToken: string
  size: number
}

type AvailabilityState = 'checking' | 'ready' | 'disabled' | 'unconfigured' | 'offline'

function AiAssistantButton({ user, authToken, size }: AiAssistantButtonProps) {
  const [availability, setAvailability] = useState<AvailabilityState>('checking')
  const isAdministrator = String(user.role || '').trim().toLowerCase() === 'administrator'
  const isUserVisible = user.ai_assistant_visible ?? true
  const shouldCheckAvailability = isAdministrator && isUserVisible && Boolean(authToken)

  useEffect(() => {
    if (!shouldCheckAvailability) {
      return
    }
    let active = true
    void getAiAssistantSettings({ token: authToken })
      .then((settings) => {
        if (!active) {
          return
        }
        if (!settings.enabled) {
          setAvailability('disabled')
        } else if (!settings.configured) {
          setAvailability('unconfigured')
        } else {
          setAvailability(settings.visible ? 'ready' : 'disabled')
        }
      })
      .catch(() => {
        if (active) {
          setAvailability('offline')
        }
      })
    return () => {
      active = false
    }
  }, [authToken, shouldCheckAvailability])

  if (!isAdministrator || !isUserVisible) {
    return null
  }

  const tooltipByState: Record<AvailabilityState, string> = {
    checking: 'AI-помощник',
    ready: 'AI-помощник',
    disabled: 'AI-помощник выключен на backend',
    unconfigured: 'AI-помощнику нужен POLZA_API_KEY',
    offline: 'Backend AI-помощника недоступен',
  }
  const statusColor = availability === 'ready' ? '#6ee7b7' : availability === 'checking' ? 'var(--morius-accent)' : '#ffb86b'

  return (
    <Tooltip title={tooltipByState[availability]}>
      <IconButton
        type="button"
        aria-label="Открыть AI-помощника"
        onClick={() => window.dispatchEvent(new CustomEvent(AI_ASSISTANT_OPEN_EVENT))}
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          color: 'var(--morius-title-text)',
          backgroundColor: 'color-mix(in srgb, var(--morius-accent) 14%, transparent)',
          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 42%, var(--morius-card-border))',
          boxShadow: '0 0 22px color-mix(in srgb, var(--morius-accent) 20%, transparent)',
          position: 'relative',
          '&:hover': {
            backgroundColor: 'color-mix(in srgb, var(--morius-accent) 22%, transparent)',
            boxShadow: '0 0 28px color-mix(in srgb, var(--morius-accent) 28%, transparent)',
          },
        }}
      >
        <ThemedSvgIcon markup={aiIconMarkup} size={Math.max(18, Math.round(size * 0.48))} />
        <Box
          component="span"
          sx={{
            position: 'absolute',
            right: Math.max(3, Math.round(size * 0.08)),
            bottom: Math.max(3, Math.round(size * 0.08)),
            width: Math.max(8, Math.round(size * 0.2)),
            height: Math.max(8, Math.round(size * 0.2)),
            borderRadius: '50%',
            backgroundColor: statusColor,
            border: '2px solid var(--morius-card-bg)',
          }}
        />
      </IconButton>
    </Tooltip>
  )
}

export default AiAssistantButton
