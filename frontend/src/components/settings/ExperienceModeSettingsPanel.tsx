import { useCallback, useState } from 'react'
import { Box, ButtonBase, CircularProgress, Stack, SvgIcon, Typography } from '@mui/material'
import { updateOnboardingGuideState } from '../../services/authApi'
import {
  EXPERIENCE_MODE_PRESETS,
  EXPERIENCE_MODE_SWITCH_HINT,
  type ExperienceModePreset,
} from '../../constants/experienceModes'
import useExperienceMode from '../../hooks/useExperienceMode'
import { writeExperienceMode, type ExperienceMode } from '../../utils/experienceMode'

type ExperienceModeSettingsPanelProps = {
  userId: number
  authToken: string
}

function CheckMark() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 14, height: 14, flexShrink: 0, mt: '3px' }}>
      <path
        d="m5 12.5 4.2 4.2L19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SvgIcon>
  )
}

/**
 * The Сложность tab. Switching here is what the welcome dialog promises is always possible, so it
 * applies at once - the game screen reads the mirrored value and re-renders - and only then tells
 * the server. A failed request leaves the local choice standing and says so.
 */
function ExperienceModeSettingsPanel({ userId, authToken }: ExperienceModeSettingsPanelProps) {
  const { mode } = useExperienceMode(userId)
  const [pendingMode, setPendingMode] = useState<ExperienceMode | null>(null)
  const [error, setError] = useState('')
  const [isJustSaved, setIsJustSaved] = useState(false)

  const handleSelect = useCallback(
    (nextMode: ExperienceMode) => {
      if (nextMode === mode || pendingMode) {
        return
      }

      setError('')
      setIsJustSaved(false)
      setPendingMode(nextMode)
      writeExperienceMode(userId, nextMode)

      void updateOnboardingGuideState(authToken, { experience_level: nextMode })
        .then(() => {
          setIsJustSaved(true)
          window.setTimeout(() => setIsJustSaved(false), 2600)
        })
        .catch(() => {
          setError('Режим применён на этом устройстве, но сохранить его не удалось. Попробуйте ещё раз.')
        })
        .finally(() => {
          setPendingMode(null)
        })
    },
    [authToken, mode, pendingMode, userId],
  )

  const renderModeCard = (preset: ExperienceModePreset) => {
    const isActive = mode === preset.id
    const isPending = pendingMode === preset.id

    return (
      <ButtonBase
        key={preset.id}
        onClick={() => handleSelect(preset.id)}
        disabled={Boolean(pendingMode)}
        aria-pressed={isActive}
        sx={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          p: 1.4,
          borderRadius: '16px',
          border: isActive
            ? '2px solid var(--morius-accent)'
            : '2px solid color-mix(in srgb, var(--morius-card-border) 90%, transparent)',
          backgroundColor: isActive
            ? 'color-mix(in srgb, var(--morius-accent) 10%, var(--morius-elevated-bg))'
            : 'color-mix(in srgb, var(--morius-elevated-bg) 76%, transparent)',
          transition: 'border-color 180ms ease, background-color 180ms ease',
          '&:hover': { borderColor: isActive ? 'var(--morius-accent)' : 'color-mix(in srgb, var(--morius-accent) 50%, var(--morius-card-border))' },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.7 }}>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.02rem', fontWeight: 900, lineHeight: 1.2, flex: 1, minWidth: 0 }}>
            {preset.label}
          </Typography>
          {isPending ? <CircularProgress size={15} sx={{ color: 'var(--morius-accent)' }} /> : null}
          {isActive && !isPending ? (
            <Box
              component="span"
              sx={{
                px: 0.85,
                height: 21,
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '999px',
                fontSize: '0.66rem',
                fontWeight: 900,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--morius-accent-contrast, #161009)',
                backgroundColor: 'var(--morius-accent)',
              }}
            >
              Включён
            </Box>
          ) : null}
        </Stack>

        <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.86rem', lineHeight: 1.42 }}>
          {preset.tagline}
        </Typography>

        <Stack spacing={0.45} sx={{ mt: 0.9 }}>
          {preset.bullets.map((bullet) => (
            <Stack key={bullet} direction="row" spacing={0.65} alignItems="flex-start">
              <Box sx={{ color: isActive ? 'var(--morius-accent)' : 'var(--morius-text-secondary)' }}>
                <CheckMark />
              </Box>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.81rem', lineHeight: 1.38 }}>{bullet}</Typography>
            </Stack>
          ))}
        </Stack>
      </ButtonBase>
    )
  }

  return (
    <Box
      sx={{
        borderRadius: '16px',
        border: 'var(--morius-border-width) solid var(--morius-card-border)',
        backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 76%, transparent)',
        p: 1.5,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.4 }}>
        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 800, flex: 1, minWidth: 0 }}>
          Сложность
        </Typography>
        {isJustSaved ? (
          <Typography sx={{ color: 'var(--morius-accent)', fontSize: '0.78rem', fontWeight: 800 }}>Сохранено</Typography>
        ) : null}
      </Stack>

      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.85rem', lineHeight: 1.45, mb: 1.3 }}>
        Сколько настроек показывать в игре. На сами истории, модели и цены режим не влияет —
        меняется только то, сколько рычагов у вас перед глазами. Переключается в любой момент и
        применяется сразу.
      </Typography>

      <Stack spacing={1.1}>{EXPERIENCE_MODE_PRESETS.map((preset) => renderModeCard(preset))}</Stack>

      {error ? (
        <Typography sx={{ mt: 1.1, color: '#ffb4b4', fontSize: '0.82rem', lineHeight: 1.4 }}>{error}</Typography>
      ) : null}

      {mode === null ? (
        <Typography sx={{ mt: 1.1, color: 'var(--morius-text-secondary)', fontSize: '0.8rem', lineHeight: 1.4 }}>
          {EXPERIENCE_MODE_SWITCH_HINT}
        </Typography>
      ) : null}
    </Box>
  )
}

export default ExperienceModeSettingsPanel
