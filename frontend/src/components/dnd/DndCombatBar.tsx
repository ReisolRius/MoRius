// The initiative strip that appears above the scene while a fight is on.
//
// It has exactly two jobs: say whose turn it is, and show how badly everyone is hurt. The
// order, the round counter and every initiative value come from the server — this component
// never computes a turn, it only draws the one the rules produced. That is why a reload
// mid-fight cannot change who acts next.
//
// It sits in the chat column rather than the rail because a fight is about the scene, and it
// collapses to a single row of avatars on a phone, where a table would not fit at all.

import { Box, Button, Stack, Tooltip, Typography } from '@mui/material'
import type { DndCombat, DndCombatant } from '../../types/story'
import { healthColor, healthRatio } from './dndDisplay'
import { DndD20Icon, DndSwordsIcon } from './DndIcons'

export type DndCombatBarProps = {
  combat: DndCombat | null
  heroAvatarUrl?: string | null
  resolveAvatar: (participant: DndCombatant) => string | null
  rolling: boolean
  onRollInitiative: () => void
  onAdvanceTurn: () => void
  onEndCombat: () => void
}

const barButtonSx = {
  minHeight: 24,
  py: 0,
  px: 0.7,
  borderRadius: '8px',
  textTransform: 'none',
  color: 'var(--morius-text-secondary)',
  fontSize: '0.68rem',
  fontWeight: 800,
  flexShrink: 0,
  '&:hover': { color: 'var(--morius-title-text)', backgroundColor: 'transparent' },
} as const

const SIDE_ACCENT: Record<DndCombatant['side'], string> = {
  hero: 'var(--morius-accent)',
  ally: '#5bb87a',
  enemy: '#e05252',
}

function Combatant({
  participant,
  isCurrent,
  avatarUrl,
}: {
  participant: DndCombatant
  isCurrent: boolean
  avatarUrl: string | null
}) {
  const accent = SIDE_ACCENT[participant.side]
  const ratio = healthRatio(participant.hp.current, participant.hp.max)
  const down = participant.is_down
  return (
    <Tooltip
      disableInteractive
      title={
        `${participant.name}${participant.role ? ` · ${participant.role}` : ''} — ` +
        (down
          ? 'повержен'
          : `хиты ${participant.hp.current}/${participant.hp.max}, КД ${participant.armor_class}` +
            (participant.initiative !== null ? `, инициатива ${participant.initiative}` : ''))
      }
    >
      <Stack
        alignItems="center"
        spacing={0.3}
        sx={{
          minWidth: 56,
          flexShrink: 0,
          opacity: down ? 0.42 : 1,
          transition: 'opacity 320ms ease',
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: 42,
            height: 42,
            borderRadius: '13px',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent)',
            border: isCurrent
              ? `2px solid ${accent}`
              : 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 70%, transparent)',
            // The active combatant is the one thing a player must never have to hunt for.
            boxShadow: isCurrent ? `0 0 0 3px color-mix(in srgb, ${accent} 26%, transparent)` : 'none',
            transition: 'box-shadow 260ms ease, border-color 260ms ease',
          }}
        >
          {avatarUrl ? (
            <Box
              component="img"
              src={avatarUrl}
              alt=""
              decoding="async"
              sx={{ width: '100%', height: '100%', objectFit: 'cover', filter: down ? 'grayscale(1)' : 'none' }}
            />
          ) : (
            <Typography sx={{ color: accent, fontSize: '1.1rem', fontWeight: 950, lineHeight: 1 }}>
              {(participant.name || '?').trim().charAt(0).toUpperCase()}
            </Typography>
          )}
          {participant.initiative !== null ? (
            <Box
              sx={{
                position: 'absolute',
                top: 1,
                right: 1,
                minWidth: 16,
                height: 15,
                px: 0.3,
                borderRadius: '5px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(8, 10, 16, 0.88)',
              }}
            >
              <Typography sx={{ color: accent, fontSize: '0.58rem', fontWeight: 950, lineHeight: 1 }}>
                {participant.initiative}
              </Typography>
            </Box>
          ) : null}
        </Box>
        <Box
          sx={{
            width: 42,
            height: 3.5,
            borderRadius: '999px',
            overflow: 'hidden',
            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 64%, #000 36%)',
          }}
        >
          <Box
            sx={{
              width: `${Math.round(ratio * 100)}%`,
              height: '100%',
              borderRadius: '999px',
              backgroundColor: healthColor(ratio),
              transition: 'width 480ms cubic-bezier(0.22, 1, 0.36, 1), background-color 380ms ease',
            }}
          />
        </Box>
        <Typography
          noWrap
          sx={{
            maxWidth: 58,
            color: isCurrent ? 'var(--morius-title-text)' : 'var(--morius-text-secondary)',
            fontSize: '0.62rem',
            fontWeight: isCurrent ? 950 : 800,
            lineHeight: 1.2,
          }}
        >
          {participant.name}
        </Typography>
      </Stack>
    </Tooltip>
  )
}

export default function DndCombatBar({
  combat,
  heroAvatarUrl = null,
  resolveAvatar,
  rolling,
  onRollInitiative,
  onAdvanceTurn,
  onEndCombat,
}: DndCombatBarProps) {
  if (!combat?.active || combat.participants.length === 0) {
    return null
  }
  const awaitingInitiative = combat.phase === 'initiative'
  const heroNeedsRoll =
    awaitingInitiative && combat.participants.some((item) => item.side === 'hero' && item.initiative === null)
  const currentIndex = combat.phase === 'active' ? combat.turn_index : -1

  return (
    <Box
      sx={{
        borderRadius: '16px',
        border: 'var(--morius-border-width) solid color-mix(in srgb, #e05252 30%, var(--morius-card-border))',
        backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 94%, #000 6%)',
        backgroundImage: 'linear-gradient(180deg, rgba(224, 82, 82, 0.09), transparent 62%)',
        px: 1.1,
        py: 0.9,
        animation: 'morius-dnd-combat-in 360ms cubic-bezier(0.22, 1, 0.36, 1)',
        '@keyframes morius-dnd-combat-in': {
          from: { opacity: 0, transform: 'translateY(-8px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.7 }}>
        <DndSwordsIcon size={17} sx={{ color: '#e05252', flexShrink: 0 }} />
        <Typography
          noWrap
          sx={{ color: 'var(--morius-title-text)', fontSize: '0.8rem', fontWeight: 950, letterSpacing: '0.02em' }}
        >
          {combat.title || 'Бой'}
        </Typography>
        <Typography
          noWrap
          sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem', fontWeight: 800, flex: 1, minWidth: 0 }}
        >
          {awaitingInitiative
            ? '· инициатива'
            : `· раунд ${combat.round}${
                combat.participants[currentIndex]
                  ? ` · ходит ${combat.participants[currentIndex].name}`
                  : ''
              }`}
        </Typography>
        {/* The order normally moves on its own, from what the narrator described. This is the
            way out when it did not — a stuck initiative should never be a dead end. */}
        {combat.phase === 'active' ? (
          <Tooltip disableInteractive title="Передать ход следующему">
            <Button onClick={onAdvanceTurn} sx={barButtonSx}>
              Дальше
            </Button>
          </Tooltip>
        ) : null}
        <Button onClick={onEndCombat} sx={barButtonSx}>
          Завершить
        </Button>
      </Stack>

      <Stack
        direction="row"
        spacing={0.5}
        sx={{ overflowX: 'auto', pb: 0.3, '&::-webkit-scrollbar': { height: 4 } }}
      >
        {combat.participants.map((participant, index) => (
          <Combatant
            key={participant.key}
            participant={participant}
            isCurrent={index === currentIndex}
            avatarUrl={
              participant.side === 'hero' ? heroAvatarUrl ?? resolveAvatar(participant) : resolveAvatar(participant)
            }
          />
        ))}
      </Stack>

      {heroNeedsRoll ? (
        <Button
          onClick={onRollInitiative}
          disabled={rolling}
          fullWidth
          startIcon={<DndD20Icon size={17} />}
          sx={{
            mt: 0.75,
            minHeight: 36,
            borderRadius: '11px',
            textTransform: 'none',
            fontSize: '0.84rem',
            fontWeight: 950,
            color: '#11070A !important',
            background:
              'var(--morius-accent) !important',
            '&.Mui-disabled': {
              color: 'color-mix(in srgb, var(--morius-title-text) 52%, transparent) !important',
              background: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, #000 12%) !important',
            },
          }}
        >
          {rolling ? 'Бросаем…' : 'Бросить инициативу'}
        </Button>
      ) : null}
    </Box>
  )
}
