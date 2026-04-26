import { Box, Button, Checkbox, CircularProgress, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import type { SmartRegenerationMode, SmartRegenerationOption } from '../../types/story'
import {
  SMART_REGENERATION_MODE_DEFINITIONS,
  SMART_REGENERATION_OPTION_DEFINITIONS,
} from '../../utils/advancedRegeneration'
import BaseDialog from '../dialogs/BaseDialog'

type AdvancedRegenerationDialogProps = {
  open: boolean
  selectedMode: SmartRegenerationMode
  selectedOptions: SmartRegenerationOption[]
  disabled?: boolean
  onClose: () => void
  onModeChange: (mode: SmartRegenerationMode) => void
  onToggleOption: (option: SmartRegenerationOption) => void
  onDefaultRegenerate: () => void
  onSmartRegenerate: () => void
}

function AdvancedRegenerationDialog({
  open,
  selectedMode,
  selectedOptions,
  disabled = false,
  onClose,
  onModeChange,
  onToggleOption,
  onDefaultRegenerate,
  onSmartRegenerate,
}: AdvancedRegenerationDialogProps) {
  const selectedOptionSet = new Set(selectedOptions)
  const hasSelectedMutableOptions = selectedOptions.some((option) => option !== 'preserve_format')

  return (
    <BaseDialog
      open={open}
      onClose={disabled ? () => undefined : onClose}
      maxWidth="md"
      header={
        <Stack spacing={0.45}>
          <Typography sx={{ fontSize: '1.16rem', fontWeight: 800, color: 'var(--morius-title-text)' }}>
            Что изменить в ответе?
          </Typography>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.92rem', lineHeight: 1.45 }}>
            Выберите режим и один или несколько пунктов. Формат реплик и персонажей будет сохранён.
          </Typography>
        </Stack>
      }
      contentSx={{
        maxHeight: { xs: '68vh', sm: '64vh' },
        overflowY: 'auto',
      }}
      actions={
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={0.75}
          justifyContent="flex-end"
          sx={{ width: '100%' }}
        >
          <Button onClick={onClose} disabled={disabled} sx={{ color: 'var(--morius-text-secondary)' }}>
            Отмена
          </Button>
          <Button
            onClick={onDefaultRegenerate}
            disabled={disabled}
            sx={{
              color: 'var(--morius-title-text)',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 72%, #000 28%)',
            }}
          >
            Обычная перегенерация
          </Button>
          <Button
            onClick={onSmartRegenerate}
            disabled={disabled || !hasSelectedMutableOptions}
            sx={{
              color: 'var(--morius-text-primary)',
              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 52%, var(--morius-card-border))',
              backgroundColor: 'var(--morius-button-active)',
              '&.Mui-disabled': {
                color: 'var(--morius-text-secondary)',
                opacity: 0.56,
              },
            }}
          >
            {disabled ? (
              <Stack direction="row" spacing={0.75} alignItems="center">
                <CircularProgress size={14} sx={{ color: 'currentColor' }} />
                <span>Перегенерация...</span>
              </Stack>
            ) : (
              'Перегенерировать'
            )}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={0.55} sx={{ mb: 1 }}>
        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.88rem', fontWeight: 800 }}>
          Режим:
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={selectedMode}
          onChange={(_, nextMode: SmartRegenerationMode | null) => {
            if (nextMode !== null) {
              onModeChange(nextMode)
            }
          }}
          disabled={disabled}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 0.6,
            '& .MuiToggleButtonGroup-grouped': {
              minWidth: 0,
              m: '0 !important',
              borderRadius: '8px !important',
              border: 'var(--morius-border-width) solid var(--morius-card-border) !important',
            },
          }}
        >
          {SMART_REGENERATION_MODE_DEFINITIONS.map((mode) => (
            <ToggleButton
              key={mode.id}
              value={mode.id}
              title={mode.description}
              sx={{
                minHeight: 36,
                px: 1.2,
                color: 'var(--morius-text-secondary)',
                fontSize: '0.86rem',
                fontWeight: 800,
                textTransform: 'none',
                backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #000 18%)',
                '&.Mui-selected': {
                  color: 'var(--morius-text-primary)',
                  backgroundColor: 'color-mix(in srgb, var(--morius-accent) 20%, var(--morius-elevated-bg))',
                },
                '&.Mui-selected:hover': {
                  backgroundColor: 'color-mix(in srgb, var(--morius-accent) 25%, var(--morius-elevated-bg))',
                },
              }}
            >
              {mode.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 0.8,
        }}
      >
        {SMART_REGENERATION_OPTION_DEFINITIONS.map((option) => {
          const checked = selectedOptionSet.has(option.id)
          const optionDisabled = disabled || option.disabled === true
          return (
            <Box
              key={option.id}
              component="label"
              sx={{
                minWidth: 0,
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr)',
                gap: 0.72,
                alignItems: 'flex-start',
                p: 1,
                borderRadius: '8px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: checked
                  ? 'color-mix(in srgb, var(--morius-accent) 15%, var(--morius-elevated-bg))'
                  : 'color-mix(in srgb, var(--morius-elevated-bg) 82%, #000 18%)',
                cursor: optionDisabled ? 'default' : 'pointer',
                opacity: optionDisabled && option.id !== 'preserve_format' ? 0.58 : 1,
              }}
            >
              <Checkbox
                checked={checked}
                disabled={optionDisabled}
                onChange={() => onToggleOption(option.id)}
                sx={{
                  p: 0.1,
                  color: 'var(--morius-text-secondary)',
                  '&.Mui-checked': {
                    color: 'var(--morius-accent)',
                  },
                }}
              />
              <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', fontWeight: 800 }}>
                  {option.label}
                </Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', lineHeight: 1.38 }}>
                  {option.description}
                </Typography>
              </Stack>
            </Box>
          )
        })}
      </Box>
    </BaseDialog>
  )
}

export default AdvancedRegenerationDialog
