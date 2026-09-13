// The dice dialog: the one moment in a D&D turn where the interface stops being a text box.
//
// The player sees what is being rolled and against what before touching anything, taps once,
// watches the die tumble, and gets a verdict they can read at a glance. The roll itself
// happens on the server — this component only asks for it and animates the answer, so a
// reload mid-animation cannot change the result.
//
// Animation is pure CSS: keyframes on a transform for the tumble, a short number scramble
// driven by one interval, then a settle. No library, nothing to load, and it degrades to a
// plain number if `prefers-reduced-motion` is set.

import { Box, Button, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DndCatalog, DndPendingCheck, DndRoll } from '../../types/story'
import BaseDialog from '../dialogs/BaseDialog'
import {
  DND_OUTCOME_LABELS,
  describeCheckKind,
  describeCheckSubject,
  difficultyLabel,
  formatModifier,
  outcomeColor,
} from './dndDisplay'
import { DndD20Icon, DndSkullIcon } from './DndIcons'

export type DndDiceDialogProps = {
  open: boolean
  check: DndPendingCheck | null
  roll: DndRoll | null
  catalog: DndCatalog | null
  rolling: boolean
  error: string
  onRoll: () => void
  // "Без броска": the action still happens, the dice simply do not decide it.
  onSkip: () => void
  // Dismissing the dialog before rolling: the turn is called off and the text goes back to
  // the composer, so a stray Escape never eats what the player wrote.
  onCancel: () => void
  onContinue: () => void
}

const TUMBLE_MS = 1450
const SCRAMBLE_INTERVAL_MS = 52

type Phase = 'ready' | 'tumbling' | 'settled'

function DieFace({
  die,
  value,
  phase,
  reducedMotion,
  accent,
}: {
  die: number
  value: number | null
  phase: Phase
  reducedMotion: boolean
  accent: string
}) {
  const isTumbling = phase === 'tumbling' && !reducedMotion
  const isSettled = phase === 'settled'
  return (
    <Box
      sx={{
        position: 'relative',
        width: 132,
        height: 132,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        mx: 'auto',
        // The die falls into frame rather than appearing in it, which is what makes the
        // throw feel like a throw instead of a spinner.
        animation: isTumbling ? `morius-dice-toss ${TUMBLE_MS}ms cubic-bezier(0.3, 0.7, 0.3, 1) forwards` : 'none',
        '@keyframes morius-dice-toss': {
          '0%': { transform: 'translateY(-18px) scale(0.86)' },
          '18%': { transform: 'translateY(6px) scale(1.06)' },
          '42%': { transform: 'translateY(-10px) scale(0.97)' },
          '68%': { transform: 'translateY(4px) scale(1.02)' },
          '86%': { transform: 'translateY(-2px) scale(0.995)' },
          '100%': { transform: 'translateY(0) scale(1)' },
        },
      }}
    >
      {/* A shadow under the die, tightening as it lands: the cue that sells the drop. */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          bottom: 2,
          left: '50%',
          width: 72,
          height: 9,
          borderRadius: '50%',
          transform: 'translateX(-50%)',
          background: 'radial-gradient(ellipse, rgba(0,0,0,0.5), transparent 72%)',
          animation: isTumbling ? `morius-dice-shadow ${TUMBLE_MS}ms cubic-bezier(0.3, 0.7, 0.3, 1) forwards` : 'none',
          '@keyframes morius-dice-shadow': {
            '0%': { opacity: 0.18, transform: 'translateX(-50%) scaleX(0.6)' },
            '18%': { opacity: 0.55, transform: 'translateX(-50%) scaleX(1.08)' },
            '42%': { opacity: 0.3, transform: 'translateX(-50%) scaleX(0.78)' },
            '100%': { opacity: 0.46, transform: 'translateX(-50%) scaleX(1)' },
          },
        }}
      />
      {/* A ring that snaps outward the moment the number lands. */}
      {isSettled ? (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 6,
            borderRadius: '50%',
            border: `2px solid ${accent}`,
            animation: 'morius-dice-impact 620ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
            '@keyframes morius-dice-impact': {
              from: { opacity: 0.85, transform: 'scale(0.72)' },
              to: { opacity: 0, transform: 'scale(1.45)' },
            },
          }}
        />
      ) : null}
      {/* Glow behind the die, brightening as the result settles. */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: -14,
          borderRadius: '50%',
          background: `radial-gradient(circle, color-mix(in srgb, ${accent} 44%, transparent) 0%, transparent 68%)`,
          opacity: phase === 'settled' ? 1 : 0.42,
          transform: phase === 'settled' ? 'scale(1.06)' : 'scale(0.92)',
          transition: 'opacity 420ms ease, transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
      <Box
        sx={{
          position: 'relative',
          width: 118,
          height: 118,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: accent,
          transformStyle: 'preserve-3d',
          animation: isTumbling
            ? `morius-dice-tumble ${TUMBLE_MS}ms cubic-bezier(0.16, 0.78, 0.28, 1) forwards`
            : isSettled
              ? 'morius-dice-land 440ms cubic-bezier(0.22, 1, 0.36, 1)'
              : 'none',
          // Spins fast, then visibly *slows* into its final face instead of stopping dead --
          // the easing does the work, the keyframes only keep the rotation uneven enough to
          // look like a physical object rather than a loading spinner.
          '@keyframes morius-dice-tumble': {
            '0%': { transform: 'rotateX(0deg) rotateY(0deg) rotateZ(0deg)' },
            '25%': { transform: 'rotateX(520deg) rotateY(300deg) rotateZ(40deg)' },
            '55%': { transform: 'rotateX(900deg) rotateY(660deg) rotateZ(-25deg)' },
            '80%': { transform: 'rotateX(1120deg) rotateY(860deg) rotateZ(12deg)' },
            '100%': { transform: 'rotateX(1188deg) rotateY(900deg) rotateZ(0deg)' },
          },
          '@keyframes morius-dice-land': {
            '0%': { transform: 'scale(1.14)' },
            '55%': { transform: 'scale(0.95)' },
            '100%': { transform: 'scale(1)' },
          },
        }}
      >
        <DndD20Icon size={118} sx={{ position: 'absolute', inset: 0, opacity: 0.9 }} />
        <Typography
          sx={{
            position: 'relative',
            color: 'var(--morius-title-text)',
            fontSize: value !== null && value >= 100 ? '1.6rem' : '2.25rem',
            fontWeight: 950,
            lineHeight: 1,
            textShadow: '0 2px 14px rgba(0,0,0,0.62)',
            transform: phase === 'settled' ? 'scale(1)' : 'scale(0.92)',
            transition: 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)',
            // While tumbling the scrambling digits stay dim, so the real number arriving
            // reads as an event rather than one more frame of noise.
            opacity: isTumbling ? 0.72 : 1,
            animation: isSettled ? 'morius-dice-number 520ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
            '@keyframes morius-dice-number': {
              '0%': { transform: 'scale(1.5)', opacity: 0.2 },
              '45%': { transform: 'scale(0.92)', opacity: 1 },
              '100%': { transform: 'scale(1)', opacity: 1 },
            },
          }}
        >
          {value ?? `d${die}`}
        </Typography>
      </Box>
    </Box>
  )
}

export default function DndDiceDialog({
  open,
  check,
  roll,
  catalog,
  rolling,
  error,
  onRoll,
  onSkip,
  onCancel,
  onContinue,
}: DndDiceDialogProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  // Only two pieces of state, and both are written exclusively from timer callbacks: which
  // roll has finished animating, and the number currently on the face. The phase is derived
  // from them, so there is nothing to reset when the dialog closes and no render cascade.
  const [settledRollId, setSettledRollId] = useState<string | null>(null)
  const [displayValue, setDisplayValue] = useState<number | null>(null)
  const scrambleRef = useRef<number | null>(null)
  const settleRef = useRef<number | null>(null)

  const clearTimers = useCallback(() => {
    if (scrambleRef.current !== null) {
      window.clearInterval(scrambleRef.current)
      scrambleRef.current = null
    }
    if (settleRef.current !== null) {
      window.clearTimeout(settleRef.current)
      settleRef.current = null
    }
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  // When the server's answer arrives, run the tumble and land on the real number. With
  // reduced motion the settle fires on the next tick instead, so the result is immediate.
  useEffect(() => {
    clearTimers()
    if (!open || !roll) {
      return undefined
    }
    const sides = roll.die || 20
    if (!reducedMotion) {
      scrambleRef.current = window.setInterval(() => {
        setDisplayValue(Math.floor(Math.random() * sides) + 1)
      }, SCRAMBLE_INTERVAL_MS)
    }
    settleRef.current = window.setTimeout(
      () => {
        if (scrambleRef.current !== null) {
          window.clearInterval(scrambleRef.current)
          scrambleRef.current = null
        }
        setDisplayValue(roll.natural)
        setSettledRollId(roll.id)
      },
      reducedMotion ? 0 : TUMBLE_MS,
    )
    return clearTimers
  }, [open, roll, reducedMotion, clearTimers])

  const phase: Phase = !open || !roll ? 'ready' : settledRollId === roll.id ? 'settled' : 'tumbling'

  const activeCheck = roll?.check ?? check
  const die = activeCheck?.die ?? roll?.die ?? 20
  const dc = activeCheck?.dc ?? roll?.dc ?? 15
  const breakdown = roll?.modifier_breakdown ?? activeCheck?.modifier_breakdown ?? []
  const modifierTotal = roll?.modifier_total ?? breakdown.reduce((sum, item) => sum + item.value, 0)
  const advantage = roll?.advantage ?? activeCheck?.advantage ?? 'none'
  const settled = phase === 'settled' && roll !== null
  const isDeathSave = activeCheck?.kind === 'death_save'
  const groupTargets = roll?.group_targets ?? []
  const isGroupRoll = groupTargets.length > 1
  const plannedTargets = activeCheck?.group_targets ?? []
  const accent = settled
    ? isDeathSave && roll.life_state === 'dead'
      ? '#e05252'
      : outcomeColor(roll.outcome)
    : isDeathSave
      ? '#e05252'
      : 'var(--morius-accent)'

  return (
    <BaseDialog
      open={open}
      // A death save cannot be dismissed: the character is already unconscious, and closing
      // the dialog would just leave the game waiting on a roll that never comes.
      onClose={settled ? onContinue : isDeathSave ? () => undefined : onCancel}
      maxWidth="xs"
      protectTextInputClose={false}
      disableBackdropClose={rolling || (isDeathSave && !settled)}
      header={
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ pr: 4 }}>
          {isDeathSave ? <DndSkullIcon size={19} sx={{ color: '#e05252' }} /> : null}
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.1rem', fontWeight: 950 }}>
            {describeCheckKind(activeCheck?.kind)}
          </Typography>
        </Stack>
      }
      actions={
        settled ? (
          <Button
            onClick={onContinue}
            fullWidth
            sx={{
              minHeight: 46,
              borderRadius: '13px',
              textTransform: 'none',
              fontSize: '0.95rem',
              fontWeight: 950,
              color: '#11070A !important',
              background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 88%, #fff 12%), ${accent}) !important`,
            }}
          >
            Продолжить ход
          </Button>
        ) : (
          <>
            {/* A death saving throw is the one roll a player cannot decline: the character is
                unconscious, and "без броска" would mean choosing not to find out. */}
            {isDeathSave ? null : (
              <Button
                onClick={onSkip}
                disabled={rolling}
                sx={{ textTransform: 'none', color: 'var(--morius-text-secondary) !important', fontWeight: 800 }}
              >
                Без броска
              </Button>
            )}
            <Button
              onClick={onRoll}
              disabled={rolling}
              sx={{
                flex: 1,
                minHeight: 46,
                borderRadius: '13px',
                textTransform: 'none',
                fontSize: '0.95rem',
                fontWeight: 950,
                color: '#11070A !important',
                background:
                  'linear-gradient(135deg, color-mix(in srgb, var(--morius-accent) 92%, #fff 8%), var(--morius-accent)) !important',
                '&.Mui-disabled': {
                  color: 'color-mix(in srgb, var(--morius-title-text) 52%, transparent) !important',
                  background: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, #000 12%) !important',
                },
              }}
            >
              {rolling ? 'Бросаем…' : isDeathSave ? 'Спасбросок от смерти' : `Бросить d${die}`}
            </Button>
          </>
        )
      }
    >
      <Stack spacing={1.35} sx={{ textAlign: 'center' }}>
        <Stack spacing={0.2}>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.3rem', fontWeight: 950, lineHeight: 1.15 }}>
            {describeCheckSubject(catalog, activeCheck)}
          </Typography>
          {activeCheck?.reason ? (
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.83rem', lineHeight: 1.4 }}>
              {activeCheck.reason}
            </Typography>
          ) : null}
          {activeCheck?.dc_source ? (
            <Typography sx={{ color: 'var(--morius-accent)', fontSize: '0.74rem', fontWeight: 800 }}>
              {activeCheck.dc_source}
            </Typography>
          ) : null}
        </Stack>

        <Stack direction="row" spacing={0.6} justifyContent="center" flexWrap="wrap" useFlexGap>
          <Box
            sx={{
              px: 1,
              py: 0.45,
              borderRadius: '10px',
              backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
            }}
          >
            <Tooltip
              disableInteractive
              title={
                activeCheck?.dc_source
                  ? `Сложность взята не с потолка: ${activeCheck.dc_source}`
                  : 'Сложность назначил мастер по ситуации'
              }
            >
              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.8rem', fontWeight: 900 }}>
                Сложность {dc}
                {difficultyLabel(catalog, dc) ? (
                  <Box component="span" sx={{ color: 'var(--morius-text-secondary)', fontWeight: 700 }}>
                    {' · '}
                    {difficultyLabel(catalog, dc)}
                  </Box>
                ) : null}
              </Typography>
            </Tooltip>
          </Box>
          {advantage !== 'none' ? (
            <Box
              sx={{
                px: 1,
                py: 0.45,
                borderRadius: '10px',
                backgroundColor:
                  advantage === 'advantage' ? 'rgba(91, 184, 122, 0.18)' : 'rgba(224, 82, 82, 0.16)',
              }}
            >
              <Typography
                sx={{
                  color: advantage === 'advantage' ? '#7fd39c' : '#f08a8a',
                  fontSize: '0.8rem',
                  fontWeight: 900,
                }}
              >
                {advantage === 'advantage' ? 'Преимущество' : 'Помеха'}
              </Typography>
            </Box>
          ) : null}
        </Stack>

        {!settled && plannedTargets.length > 1 ? (
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.79rem', lineHeight: 1.4 }}>
            Отдельный бросок по каждой цели: {plannedTargets.join(', ')}. Кого не одолеете —
            останется на ногах.
          </Typography>
        ) : null}

        <DieFace die={die} value={roll ? displayValue : null} phase={phase} reducedMotion={reducedMotion} accent={accent} />

        {/* The maths, always visible so a player can check the modifier the game applied. */}
        <Stack direction="row" spacing={0.45} justifyContent="center" flexWrap="wrap" useFlexGap>
          {breakdown.map((part) => (
            <Box
              key={part.key}
              sx={{
                px: 0.7,
                py: 0.3,
                borderRadius: '8px',
                backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
              }}
            >
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem', fontWeight: 800 }}>
                {part.label}{' '}
                <Box component="span" sx={{ color: part.value >= 0 ? '#5bb87a' : '#e0a93f', fontWeight: 950 }}>
                  {formatModifier(part.value)}
                </Box>
              </Typography>
            </Box>
          ))}
        </Stack>

        {settled ? (
          <Stack
            spacing={0.35}
            sx={{
              py: 1,
              px: 1.1,
              borderRadius: '14px',
              border: `var(--morius-border-width) solid color-mix(in srgb, ${accent} 46%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
              animation: 'morius-dice-result-in 340ms cubic-bezier(0.22, 1, 0.36, 1)',
              '@keyframes morius-dice-result-in': {
                from: { opacity: 0, transform: 'translateY(8px) scale(0.97)' },
                to: { opacity: 1, transform: 'translateY(0) scale(1)' },
              },
            }}
          >
            <Typography sx={{ color: accent, fontSize: '1.1rem', fontWeight: 950, lineHeight: 1.2 }}>
              {DND_OUTCOME_LABELS[roll.outcome]}
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', fontWeight: 800 }}>
              {roll.rolls.length > 1 ? `${roll.rolls.join(' / ')} → ` : ''}
              {roll.natural} {formatModifier(modifierTotal)} = {roll.total} против {roll.dc}
            </Typography>
            {(roll.outcome === 'success' || roll.outcome === 'critical_success') && activeCheck?.success_hint ? (
              <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.82rem', lineHeight: 1.4 }}>
                {activeCheck.success_hint}
              </Typography>
            ) : null}
            {(roll.outcome === 'failure' || roll.outcome === 'critical_failure') && activeCheck?.failure_hint ? (
              <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.82rem', lineHeight: 1.4 }}>
                {activeCheck.failure_hint}
              </Typography>
            ) : null}

            {isGroupRoll ? (
              <Stack spacing={0.3} sx={{ pt: 0.4 }}>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem', fontWeight: 900 }}>
                  Повержено {roll.group_successes} из {roll.group_size}
                </Typography>
                {groupTargets.map((target) => {
                  const beaten = target.outcome === 'success' || target.outcome === 'critical_success'
                  return (
                    <Stack key={target.index} direction="row" spacing={0.5} alignItems="center">
                      <Box
                        sx={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          flexShrink: 0,
                          backgroundColor: beaten ? '#5bb87a' : '#e05252',
                        }}
                      />
                      <Typography
                        noWrap
                        sx={{
                          flex: 1,
                          textAlign: 'left',
                          color: beaten ? 'var(--morius-text-secondary)' : '#f08a8a',
                          fontSize: '0.76rem',
                          fontWeight: 800,
                        }}
                      >
                        {target.label}
                      </Typography>
                      <Typography
                        sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem', fontWeight: 800 }}
                      >
                        {target.total} / {target.dc}
                      </Typography>
                    </Stack>
                  )
                })}
              </Stack>
            ) : null}

            {isDeathSave ? (
              <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.82rem', lineHeight: 1.4 }}>
                {roll.life_state === 'dead'
                  ? 'Герой погиб. Рассказчик закроет историю и предложит, что делать дальше.'
                  : roll.life_state === 'stable'
                    ? 'Герой стабилизировался: он без сознания, но больше не умирает.'
                    : roll.natural === 20
                      ? 'Герой приходит в себя с одним хитом.'
                      : 'Герой всё ещё при смерти. Следующий ход — снова спасбросок.'}
              </Typography>
            ) : null}
          </Stack>
        ) : (
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.4 }}>
            {rolling
              ? 'Кубик в воздухе…'
              : isDeathSave
                ? 'Герой на нуле хитов. Три успеха — он стабилизируется, три провала — погибает.'
                : 'Бросок решит исход действия. Рассказчик получит результат и опишет последствия.'}
          </Typography>
        )}

        {error ? (
          <Typography sx={{ color: '#e07a7a', fontSize: '0.8rem', fontWeight: 800 }}>{error}</Typography>
        ) : null}
      </Stack>
    </BaseDialog>
  )
}
