import { useState } from 'react'
import { Box, ButtonBase, CircularProgress, Stack, SvgIcon, Typography } from '@mui/material'
import BaseDialog from '../dialogs/BaseDialog'
import {
  EXPERIENCE_MODE_PRESETS,
  EXPERIENCE_MODE_SWITCH_HINT,
  type ExperienceModePreset,
} from '../../constants/experienceModes'
import type { ExperienceMode } from '../../utils/experienceMode'

type ExperienceLevelDialogProps = {
  open: boolean
  isSaving: boolean
  onChoose: (mode: ExperienceMode) => void
}

function NoviceIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 26, height: 26 }}>
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="m15.4 8.6-2 4.8-4.8 2 2-4.8z" />
      </g>
    </SvgIcon>
  )
}

function ExpertIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 26, height: 26 }}>
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 6h14M5 12h14M5 18h14" />
        <circle cx="9" cy="6" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="8" cy="18" r="2" />
      </g>
    </SvgIcon>
  )
}

function CheckMark() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: 15, height: 15, flexShrink: 0, mt: '2px' }}>
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

function ExperienceLevelDialog({ open, isSaving, onChoose }: ExperienceLevelDialogProps) {
  const [selectedMode, setSelectedMode] = useState<ExperienceMode | null>(null)
  const [wasOpen, setWasOpen] = useState(open)

  // Forget a half-made choice if the dialog ever closes without one, adjusting state during
  // render rather than in an effect so no extra pass is scheduled.
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) {
      setSelectedMode(null)
    }
  }

  const renderOptionCard = (preset: ExperienceModePreset) => {
    const isSelected = selectedMode === preset.id
    return (
      <ButtonBase
        key={preset.id}
        onClick={() => setSelectedMode(preset.id)}
        disabled={isSaving}
        aria-pressed={isSelected}
        sx={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          p: { xs: 1.5, sm: 1.75 },
          borderRadius: '18px',
          border: isSelected
            ? '2px solid var(--morius-accent)'
            : '2px solid color-mix(in srgb, var(--morius-card-border) 88%, transparent)',
          backgroundColor: isSelected
            ? 'color-mix(in srgb, var(--morius-accent) 10%, var(--morius-elevated-bg))'
            : 'color-mix(in srgb, var(--morius-elevated-bg) 82%, transparent)',
          boxShadow: isSelected ? '0 18px 38px -26px rgba(0, 0, 0, 0.9)' : 'none',
          transition: 'border-color 180ms ease, background-color 180ms ease, transform 180ms ease',
          '&:hover': isSaving
            ? undefined
            : {
                borderColor: isSelected
                  ? 'var(--morius-accent)'
                  : 'color-mix(in srgb, var(--morius-accent) 52%, var(--morius-card-border))',
                transform: 'translateY(-2px)',
              },
        }}
      >
        <Stack direction="row" spacing={1.15} alignItems="center">
          <Box
            sx={{
              width: 46,
              height: 46,
              flexShrink: 0,
              borderRadius: '14px',
              display: 'grid',
              placeItems: 'center',
              color: isSelected ? 'var(--morius-accent-contrast, #161009)' : 'var(--morius-accent)',
              backgroundColor: isSelected ? 'var(--morius-accent)' : 'color-mix(in srgb, var(--morius-accent) 14%, transparent)',
              transition: 'background-color 180ms ease, color 180ms ease',
            }}
          >
            {preset.id === 'novice' ? <NoviceIcon /> : <ExpertIcon />}
          </Box>
          <Stack spacing={0.2} sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: { xs: '1.08rem', sm: '1.16rem' }, fontWeight: 900, lineHeight: 1.15 }}>
              {preset.title}
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {preset.label} режим
            </Typography>
          </Stack>
          <Box
            aria-hidden
            sx={{
              width: 22,
              height: 22,
              flexShrink: 0,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              border: isSelected ? '2px solid var(--morius-accent)' : '2px solid color-mix(in srgb, var(--morius-card-border) 92%, transparent)',
              color: 'var(--morius-accent)',
            }}
          >
            {isSelected ? <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--morius-accent)' }} /> : null}
          </Box>
        </Stack>

        <Typography sx={{ mt: 1.1, color: 'var(--morius-text-primary)', fontSize: '0.88rem', lineHeight: 1.45 }}>
          {preset.tagline}
        </Typography>

        <Stack spacing={0.55} sx={{ mt: 1.15 }}>
          {preset.bullets.map((bullet) => (
            <Stack key={bullet} direction="row" spacing={0.7} alignItems="flex-start">
              <Box sx={{ color: isSelected ? 'var(--morius-accent)' : 'color-mix(in srgb, var(--morius-text-secondary) 88%, transparent)' }}>
                <CheckMark />
              </Box>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.83rem', lineHeight: 1.4 }}>{bullet}</Typography>
            </Stack>
          ))}
        </Stack>
      </ButtonBase>
    )
  }

  return (
    <BaseDialog
      open={open}
      onClose={() => {
        // Answering is the whole point of this dialog: Escape and the backdrop do nothing.
      }}
      maxWidth="md"
      showCloseButton={false}
      disableBackdropClose
      protectTextInputClose={false}
      // This is the first thing a new player has to answer, so it outranks whatever else the
      // home page opens on arrival (the creator-reward promo, for one).
      zIndex={1500}
      paperSx={{ overflow: 'hidden' }}
      // On a phone the two cards scroll under the footer, so the footer needs an edge of its own -
      // otherwise the second card just looks cut off.
      actionsSx={{
        pt: 'var(--morius-content-gap)',
        borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 82%, transparent)',
        backgroundColor: 'rgba(0, 0, 0, 0.14)',
      }}
      header={
        <Stack spacing={0.65}>
          <Typography
            sx={{
              color: 'var(--morius-accent)',
              fontSize: '0.7rem',
              fontWeight: 800,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
            }}
          >
            Добро пожаловать в Moru
          </Typography>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: { xs: '1.5rem', sm: '1.85rem' }, fontWeight: 900, lineHeight: 1.08 }}>
            Какой у вас уровень?
          </Typography>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, fontWeight: 500 }}>
            От ответа зависит только то, сколько настроек вы увидите в игре. Сами истории, модели и
            возможности одинаковые в обоих режимах.
          </Typography>
        </Stack>
      }
      actions={
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.2}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
          sx={{ width: '100%' }}
        >
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem', lineHeight: 1.4 }}>
            {EXPERIENCE_MODE_SWITCH_HINT}
          </Typography>
          <ButtonBase
            onClick={() => {
              if (selectedMode) {
                onChoose(selectedMode)
              }
            }}
            disabled={!selectedMode || isSaving}
            sx={{
              minHeight: 46,
              px: 2.6,
              flexShrink: 0,
              borderRadius: '999px',
              gap: 0.9,
              fontSize: '0.95rem',
              fontWeight: 900,
              color: selectedMode ? 'var(--morius-accent-contrast, #161009)' : 'var(--morius-quiet-text)',
              backgroundColor: selectedMode ? 'var(--morius-accent)' : 'var(--morius-elevated-bg)',
              transition: 'background-color 180ms ease, filter 180ms ease',
              '&:hover': selectedMode && !isSaving ? { filter: 'brightness(1.08)' } : undefined,
              '&.Mui-disabled': { color: 'var(--morius-quiet-text)', backgroundColor: 'var(--morius-elevated-bg)' },
            }}
          >
            {isSaving ? <CircularProgress size={16} sx={{ color: 'inherit' }} /> : null}
            Продолжить
          </ButtonBase>
        </Stack>
      }
    >
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 1.1, sm: 1.4 },
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          alignItems: 'stretch',
        }}
      >
        {EXPERIENCE_MODE_PRESETS.map((preset) => renderOptionCard(preset))}
      </Box>
    </BaseDialog>
  )
}

export default ExperienceLevelDialog
