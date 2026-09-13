// Level-up: spend the +2 ability points 5e grants at levels 4, 8, 12, 16 and 19.
//
// The dialog refuses to let a score past 20 and refuses to overspend, then the server checks
// both again. Hit points and the proficiency bonus have already been applied by the time this
// opens — they follow from the level and are not a choice.

import { Box, Button, Stack, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import type { DndAbilityId, DndState } from '../../types/story'
import BaseDialog from '../dialogs/BaseDialog'
import DndSurfaceButton from './DndSurfaceButton'
import { DND_ABILITY_LABELS, DND_ABILITY_ORDER, abilityModifier, formatModifier } from './dndDisplay'
import { DndStarIcon } from './DndIcons'

export type DndLevelUpDialogProps = {
  open: boolean
  state: DndState | null
  saving: boolean
  error: string
  onClose: () => void
  onApply: (allocation: Record<string, number>) => void
}

const ABILITY_CEILING = 20

const stepperSx = {
  width: 28,
  height: 28,
  minWidth: 28,
  borderRadius: '9px',
  fontSize: '1.05rem',
  fontWeight: 900,
  color: 'var(--morius-title-text)',
} as const

export default function DndLevelUpDialog({
  open,
  state,
  saving,
  error,
  onClose,
  onApply,
}: DndLevelUpDialogProps) {
  // The parent remounts this dialog each time it opens (see its `key`), so an empty
  // allocation is simply the initial state -- no reset effect, no render cascade.
  const [allocation, setAllocation] = useState<Record<string, number>>({})

  const available = state?.hero.pending_asi_points ?? 0
  const spent = useMemo(
    () => Object.values(allocation).reduce((sum, value) => sum + value, 0),
    [allocation],
  )
  const remaining = Math.max(available - spent, 0)
  const levelUp = state?.last_level_up ?? null

  const adjust = (abilityId: DndAbilityId, delta: number) => {
    setAllocation((previous) => {
      const current = previous[abilityId] ?? 0
      const next = current + delta
      if (next < 0) {
        return previous
      }
      if (delta > 0 && remaining <= 0) {
        return previous
      }
      const base = state?.hero.abilities[abilityId] ?? 10
      if (base + next > ABILITY_CEILING) {
        return previous
      }
      const updated = { ...previous, [abilityId]: next }
      if (next === 0) {
        delete updated[abilityId]
      }
      return updated
    })
  }

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      protectTextInputClose={false}
      header={
        <Stack direction="row" spacing={0.85} alignItems="center" sx={{ pr: 4 }}>
          <DndStarIcon size={22} sx={{ color: '#f0c24a' }} />
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.14rem', fontWeight: 950 }}>
            {levelUp ? `Уровень ${levelUp.to_level}` : 'Повышение характеристик'}
          </Typography>
        </Stack>
      }
      actions={
        <>
          <Button
            onClick={onClose}
            disabled={saving}
            sx={{ textTransform: 'none', color: 'var(--morius-text-secondary) !important', fontWeight: 800 }}
          >
            Позже
          </Button>
          <Button
            onClick={() => onApply(allocation)}
            disabled={saving || spent === 0}
            sx={{
              flex: 1,
              minHeight: 44,
              borderRadius: '12px',
              textTransform: 'none',
              fontWeight: 950,
              color: '#11070A !important',
              background: 'linear-gradient(135deg, #f4d06a, #e0a93f) !important',
              '&.Mui-disabled': {
                color: 'color-mix(in srgb, var(--morius-title-text) 52%, transparent) !important',
                background: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, #000 12%) !important',
              },
            }}
          >
            {saving ? 'Применяем…' : 'Применить'}
          </Button>
        </>
      }
    >
      <Stack spacing={1.2}>
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem', lineHeight: 1.45 }}>
          {levelUp
            ? `Максимум хитов вырос до ${levelUp.max_hp}. Распределите очки повышения характеристик — по правилам 5e ни одна не может подняться выше ${ABILITY_CEILING}.`
            : `Распределите очки повышения характеристик. Предел одной характеристики — ${ABILITY_CEILING}.`}
        </Typography>

        <Box
          sx={{
            alignSelf: 'center',
            px: 1.4,
            py: 0.55,
            borderRadius: '999px',
            backgroundColor: remaining > 0 ? 'rgba(240, 194, 74, 0.16)' : 'rgba(91, 184, 122, 0.16)',
          }}
        >
          <Typography sx={{ color: remaining > 0 ? '#f0c24a' : '#7fd39c', fontSize: '0.86rem', fontWeight: 950 }}>
            Осталось очков: {remaining}
          </Typography>
        </Box>

        <Stack spacing={0.55}>
          {DND_ABILITY_ORDER.map((abilityId) => {
            const base = state?.hero.abilities[abilityId] ?? 10
            const added = allocation[abilityId] ?? 0
            const next = base + added
            const atCeiling = next >= ABILITY_CEILING
            return (
              <Stack
                key={abilityId}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  px: 1,
                  py: 0.65,
                  borderRadius: '12px',
                  border: added
                    ? 'var(--morius-border-width) solid rgba(240, 194, 74, 0.5)'
                    : 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 66%, transparent)',
                  backgroundColor: added
                    ? 'rgba(240, 194, 74, 0.09)'
                    : 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
                  transition: 'border-color 200ms ease, background-color 200ms ease',
                }}
              >
                <Typography sx={{ flex: 1, color: 'var(--morius-title-text)', fontSize: '0.88rem', fontWeight: 900 }}>
                  {DND_ABILITY_LABELS[abilityId]}
                </Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem', fontWeight: 800 }}>
                  {base}
                  {added ? (
                    <Box component="span" sx={{ color: '#f0c24a', fontWeight: 950 }}>
                      {' → '}
                      {next}
                    </Box>
                  ) : null}
                </Typography>
                <Typography
                  sx={{
                    minWidth: 30,
                    textAlign: 'right',
                    color: abilityModifier(next) >= 0 ? '#5bb87a' : '#e0a93f',
                    fontSize: '0.78rem',
                    fontWeight: 900,
                  }}
                >
                  {formatModifier(abilityModifier(next))}
                </Typography>
                <Stack direction="row" spacing={0.35}>
                  <DndSurfaceButton
                    ariaLabel={`Убрать очко из «${DND_ABILITY_LABELS[abilityId]}»`}
                    disabled={saving || added <= 0}
                    onClick={() => adjust(abilityId, -1)}
                    sx={stepperSx}
                  >
                    −
                  </DndSurfaceButton>
                  <DndSurfaceButton
                    ariaLabel={`Добавить очко в «${DND_ABILITY_LABELS[abilityId]}»`}
                    disabled={saving || remaining <= 0 || atCeiling}
                    onClick={() => adjust(abilityId, 1)}
                    sx={stepperSx}
                  >
                    +
                  </DndSurfaceButton>
                </Stack>
              </Stack>
            )
          })}
        </Stack>

        {error ? (
          <Typography sx={{ color: '#e07a7a', fontSize: '0.82rem', fontWeight: 800 }}>{error}</Typography>
        ) : null}
      </Stack>
    </BaseDialog>
  )
}
