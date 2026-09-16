// The D&D left menu: character card, experience, inventory, health, sky, conditions.
//
// It replaces the module list of an ordinary game, so it has to survive the same widths the
// menu does (a ~300px rail on desktop, a full-width drawer on mobile). Everything here is
// read-only at a glance and opens a dialog for anything editable — a panel you can
// accidentally change mid-scene is worse than one extra click.

import { Box, Button, Collapse, Skeleton, Stack, Tooltip, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import type { DndCatalog, DndState } from '../../types/story'
import {
  DND_ABILITY_LABELS,
  DND_ABILITY_ORDER,
  DND_ABILITY_SHORT,
  DND_PRIMARY_ABILITIES,
  DND_SEASON_LABELS,
  DND_TIME_LABELS,
  DND_WEATHER_LABELS,
  abilityModifier,
  formatModifier,
  healthColor,
  healthRatio,
  isDarkTimeOfDay,
  labelForClass,
  labelForRace,
  timeGradient,
  weatherOverlay,
  xpProgress,
} from './dndDisplay'
import {
  DndBackpackIcon,
  DndCoinIcon,
  DndConditionIcon,
  DndHeartIcon,
  DndShieldIcon,
  DndSkullIcon,
  DndStarIcon,
  DndTimeIcon,
  DndWeatherIcon,
} from './DndIcons'

export type DndLeftPanelProps = {
  state: DndState | null
  catalog: DndCatalog | null
  loading?: boolean
  error?: string
  heroAvatarUrl?: string | null
  onOpenSheet: () => void
  onOpenLevelUp: () => void
  onOpenEnvironment: () => void
  onChangePlayMode: (playMode: 'game' | 'sandbox') => void
}

const cardSx = {
  borderRadius: '16px',
  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 70%, transparent)',
  backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 92%, #000 8%)',
  p: 1.15,
} as const

const sectionButtonSx = {
  ...cardSx,
  width: '100%',
  textTransform: 'none',
  justifyContent: 'flex-start',
  color: 'var(--morius-title-text)',
  transition: 'border-color 160ms ease, background-color 160ms ease, transform 160ms ease',
  '&:hover': {
    borderColor: 'color-mix(in srgb, var(--morius-accent) 42%, var(--morius-card-border))',
    backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent)',
  },
  '&:active': { transform: 'scale(0.995)' },
} as const

function StatPill({ abilityId, score }: { abilityId: keyof typeof DND_ABILITY_SHORT; score: number }) {
  const modifier = abilityModifier(score)
  return (
    <Tooltip disableInteractive title={`${DND_ABILITY_LABELS[abilityId]}: ${score} (${formatModifier(modifier)})`}>
      <Stack
        alignItems="center"
        spacing={0.05}
        sx={{
          flex: '1 1 0',
          minWidth: 0,
          py: 0.5,
          px: 0.3,
          borderRadius: '11px',
          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 64%, transparent)',
          backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, transparent)',
        }}
      >
        <Typography
          sx={{
            color: 'color-mix(in srgb, var(--morius-text-secondary) 92%, transparent)',
            fontSize: '0.58rem',
            fontWeight: 900,
            letterSpacing: '0.06em',
            lineHeight: 1,
          }}
        >
          {DND_ABILITY_SHORT[abilityId]}
        </Typography>
        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.02rem', fontWeight: 950, lineHeight: 1.15 }}>
          {score}
        </Typography>
        <Typography
          sx={{
            color: modifier >= 0 ? '#5bb87a' : '#e0a93f',
            fontSize: '0.64rem',
            fontWeight: 900,
            lineHeight: 1,
          }}
        >
          {formatModifier(modifier)}
        </Typography>
      </Stack>
    </Tooltip>
  )
}

export default function DndLeftPanel({
  state,
  catalog,
  loading = false,
  error = '',
  heroAvatarUrl = null,
  onOpenSheet,
  onOpenLevelUp,
  onOpenEnvironment,
  onChangePlayMode,
}: DndLeftPanelProps) {
  const [showAllStats, setShowAllStats] = useState(false)
  const [inventoryOpen, setInventoryOpen] = useState(false)

  const progress = useMemo(() => (state ? xpProgress(state, catalog) : null), [state, catalog])

  if (loading && !state) {
    return (
      <Stack spacing={1.1}>
        <Skeleton variant="rounded" height={168} sx={{ borderRadius: '16px', bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 18%, transparent)' }} />
        <Skeleton variant="rounded" height={58} sx={{ borderRadius: '16px', bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 18%, transparent)' }} />
        <Skeleton variant="rounded" height={78} sx={{ borderRadius: '16px', bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 18%, transparent)' }} />
        <Skeleton variant="rounded" height={110} sx={{ borderRadius: '16px', bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 18%, transparent)' }} />
      </Stack>
    )
  }

  if (!state) {
    return (
      <Box sx={{ ...cardSx, textAlign: 'center', py: 2 }}>
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.86rem', fontWeight: 700 }}>
          {error || 'Лист персонажа недоступен'}
        </Typography>
      </Box>
    )
  }

  const hero = state.hero
  const hp = hero.hp
  const ratio = healthRatio(hp.current, hp.max)
  const hpColor = healthColor(ratio)
  const environment = state.environment
  const [skyFrom, skyTo] = timeGradient(environment.time_of_day)
  const overlay = weatherOverlay(environment.weather)
  const skyTextColor = isDarkTimeOfDay(environment.time_of_day) ? '#eef2fb' : '#0e1420'
  const visibleAbilities = showAllStats ? DND_ABILITY_ORDER : DND_PRIMARY_ABILITIES
  const buffs = hero.conditions.filter((item) => item.kind === 'buff')
  const debuffs = hero.conditions.filter((item) => item.kind === 'debuff')
  const isSandbox = state.play_mode === 'sandbox'
  const environmentEditable = !environment.locked || isSandbox

  return (
    <Stack spacing={1.1}>
      {error ? (
        <Typography sx={{ color: '#e07a7a', fontSize: '0.76rem', fontWeight: 800, px: 0.2 }}>{error}</Typography>
      ) : null}

      {/* --- Character card ------------------------------------------------------------ */}
      <Box sx={{ ...cardSx, p: 0, overflow: 'hidden' }}>
        <Button
          onClick={onOpenSheet}
          sx={{
            width: '100%',
            textTransform: 'none',
            justifyContent: 'flex-start',
            p: 1.15,
            borderRadius: 0,
            color: 'var(--morius-title-text)',
            '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, transparent)' },
          }}
        >
          <Stack direction="row" spacing={1.05} alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
            <Box
              sx={{
                position: 'relative',
                width: 54,
                height: 54,
                flexShrink: 0,
                borderRadius: '14px',
                overflow: 'hidden',
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 34%, var(--morius-card-border))',
                backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {heroAvatarUrl ? (
                <Box
                  component="img"
                  src={heroAvatarUrl}
                  alt=""
                  decoding="async"
                  sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <Typography sx={{ color: 'var(--morius-accent)', fontSize: '1.5rem', fontWeight: 950, lineHeight: 1 }}>
                  {(hero.name || '?').trim().charAt(0).toUpperCase()}
                </Typography>
              )}
              <Box
                sx={{
                  position: 'absolute',
                  right: 2,
                  bottom: 2,
                  minWidth: 20,
                  height: 18,
                  px: 0.4,
                  borderRadius: '7px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(8, 10, 16, 0.86)',
                  border: '1px solid color-mix(in srgb, var(--morius-accent) 52%, transparent)',
                }}
              >
                <Typography sx={{ color: 'var(--morius-accent)', fontSize: '0.62rem', fontWeight: 950, lineHeight: 1 }}>
                  {hero.level}
                </Typography>
              </Box>
            </Box>
            <Stack spacing={0.2} sx={{ minWidth: 0, flex: 1, alignItems: 'flex-start' }}>
              <Typography
                noWrap
                sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 950, lineHeight: 1.12, width: '100%', textAlign: 'left' }}
              >
                {hero.name || 'Безымянный герой'}
              </Typography>
              <Typography
                noWrap
                sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem', fontWeight: 700, lineHeight: 1.2, width: '100%', textAlign: 'left' }}
              >
                {labelForRace(catalog, hero.race)} · {labelForClass(catalog, hero.class)}
              </Typography>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ pt: 0.15 }}>
                <Stack direction="row" spacing={0.3} alignItems="center">
                  <DndShieldIcon size={13} sx={{ color: 'var(--morius-text-secondary)' }} />
                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem', fontWeight: 900, lineHeight: 1 }}>
                    {hero.armor_class}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.3} alignItems="center">
                  <DndStarIcon size={13} sx={{ color: 'var(--morius-text-secondary)' }} />
                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem', fontWeight: 900, lineHeight: 1 }}>
                    {formatModifier(hero.proficiency_bonus)}
                  </Typography>
                </Stack>
                {isSandbox ? (
                  <Typography
                    sx={{
                      px: 0.5,
                      py: 0.1,
                      borderRadius: '6px',
                      color: '#f0c24a',
                      backgroundColor: 'rgba(240, 194, 74, 0.16)',
                      fontSize: '0.6rem',
                      fontWeight: 950,
                      lineHeight: 1.3,
                      textTransform: 'uppercase',
                    }}
                  >
                    Песочница
                  </Typography>
                ) : null}
              </Stack>
            </Stack>
          </Stack>
        </Button>

        <Box sx={{ px: 1.15, pb: 1.15 }}>
          <Stack direction="row" spacing={0.5} sx={{ mb: 0.85 }}>
            {visibleAbilities.map((abilityId) => (
              <StatPill key={abilityId} abilityId={abilityId} score={hero.abilities[abilityId] ?? 10} />
            ))}
          </Stack>
          <Button
            onClick={() => setShowAllStats((previous) => !previous)}
            sx={{
              minHeight: 26,
              py: 0,
              px: 0.6,
              borderRadius: '8px',
              textTransform: 'none',
              color: 'var(--morius-text-secondary)',
              fontSize: '0.7rem',
              fontWeight: 800,
              '&:hover': { color: 'var(--morius-title-text)', backgroundColor: 'transparent' },
            }}
          >
            {showAllStats ? 'Только основные' : 'Все характеристики'}
          </Button>

          {/* Experience: the bar is the whole point, the numbers are the footnote. */}
          {progress ? (
            <Box sx={{ mt: 0.7 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.35 }}>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.68rem', fontWeight: 900, letterSpacing: '0.05em' }}>
                  ОПЫТ
                </Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.68rem', fontWeight: 800 }}>
                  {progress.isMaxLevel
                    ? `${progress.currentXp} · максимум`
                    : `${progress.gainedInLevel} / ${progress.neededInLevel}`}
                </Typography>
              </Stack>
              <Box
                sx={{
                  position: 'relative',
                  height: 8,
                  borderRadius: '999px',
                  overflow: 'hidden',
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 70%, #000 30%)',
                }}
              >
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    width: `${Math.round(progress.ratio * 100)}%`,
                    borderRadius: '999px',
                    background: 'var(--morius-accent)',
                    transition: 'width 620ms cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                />
              </Box>
            </Box>
          ) : null}

          {hero.pending_asi_points > 0 ? (
            <Button
              onClick={onOpenLevelUp}
              fullWidth
              sx={{
                mt: 0.85,
                minHeight: 36,
                borderRadius: '10px',
                textTransform: 'none',
                fontSize: '0.82rem',
                fontWeight: 950,
                color: '#11070A',
                background: 'linear-gradient(135deg, #f4d06a, #e0a93f)',
                // A level-up is the one thing in this panel that should demand attention.
                animation: 'morius-dnd-levelup-pulse 2.4s ease-in-out infinite',
                '@keyframes morius-dnd-levelup-pulse': {
                  '0%, 100%': { boxShadow: '0 0 0 0 rgba(240, 194, 74, 0.42)' },
                  '50%': { boxShadow: '0 0 0 8px rgba(240, 194, 74, 0)' },
                },
                '&:hover': { background: 'linear-gradient(135deg, #e0a93f, #c98f2c)' },
              }}
            >
              Повышение уровня · {hero.pending_asi_points} оч.
            </Button>
          ) : null}
        </Box>
      </Box>

      {/* --- Inventory ------------------------------------------------------------------ */}
      <Box sx={{ ...cardSx, p: 0, overflow: 'hidden' }}>
        <Button
          onClick={() => setInventoryOpen((previous) => !previous)}
          sx={{
            width: '100%',
            minHeight: 46,
            px: 1.15,
            borderRadius: 0,
            textTransform: 'none',
            justifyContent: 'flex-start',
            color: 'var(--morius-title-text)',
            '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, transparent)' },
          }}
        >
          <Stack direction="row" spacing={0.85} alignItems="center" sx={{ width: '100%' }}>
            <DndBackpackIcon size={19} sx={{ color: 'var(--morius-accent)' }} />
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 900, flex: 1, textAlign: 'left' }}>Инвентарь</Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem', fontWeight: 800 }}>
              {hero.inventory.length}
            </Typography>
            <Box
              sx={{
                display: 'inline-flex',
                transform: inventoryOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 220ms ease',
                color: 'var(--morius-text-secondary)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </Box>
          </Stack>
        </Button>
        <Collapse in={inventoryOpen} timeout={220} unmountOnExit>
          <Box sx={{ px: 1.15, pb: 1.15 }}>
            {hero.inventory.length ? (
              <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.82rem', lineHeight: 1.5, fontWeight: 600 }}>
                {hero.inventory.join(', ')}
              </Typography>
            ) : (
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                Пусто
              </Typography>
            )}
            {hero.inventory_note ? (
              <Typography
                sx={{
                  mt: 0.6,
                  pt: 0.6,
                  borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 60%, transparent)',
                  color: 'var(--morius-text-secondary)',
                  fontSize: '0.79rem',
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {hero.inventory_note}
              </Typography>
            ) : null}
          </Box>
        </Collapse>
      </Box>

      {/* --- Gold ------------------------------------------------------------------------ */}
      {/* Money is not a backpack item. It changes on its own schedule -- a bribe, a reward, a
          night at an inn -- and the master tracks it from the text of the scene, so it gets a
          line of its own rather than a sentence buried under the inventory. */}
      <Box
        sx={{
          ...cardSx,
          display: 'flex',
          alignItems: 'center',
          gap: 0.85,
          py: 0.9,
          borderColor: 'color-mix(in srgb, #e0c05a 26%, var(--morius-card-border))',
        }}
      >
        <DndCoinIcon size={19} sx={{ color: '#e0c05a', flexShrink: 0 }} />
        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.9rem', fontWeight: 900, flex: 1 }}>
          Золото
        </Typography>
        {/* The purse, split into whatever coins the setting uses. Reading it off the parts
            rather than a single "gold" number is what lets small change exist at all. */}
        <Stack direction="row" spacing={0.5} alignItems="baseline" sx={{ minWidth: 0 }}>
          {(hero.purse_parts?.length ? hero.purse_parts : []).map((part) => (
            <Typography
              key={part.id}
              sx={{ color: '#e0c05a', fontSize: '0.95rem', fontWeight: 950, lineHeight: 1 }}
            >
              {part.count.toLocaleString('ru-RU')}
              <Box
                component="span"
                sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.7rem', fontWeight: 800 }}
              >
                {' '}
                {part.short}
              </Box>
            </Typography>
          ))}
          {hero.purse_parts?.length ? null : (
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', fontWeight: 900 }}>
              {hero.purse_display || '—'}
            </Typography>
          )}
        </Stack>
      </Box>

      {/* --- Death saves ------------------------------------------------------------------ */}
      {/* Only on screen when it matters, and then impossible to miss: this is the one card
          that says the character might be about to stop existing. */}
      {hero.life_state !== 'alive' ? (
        <Box
          sx={{
            ...cardSx,
            borderColor:
              hero.life_state === 'dead'
                ? 'rgba(224, 82, 82, 0.6)'
                : 'color-mix(in srgb, #e05252 34%, var(--morius-card-border))',
            backgroundColor: 'rgba(224, 82, 82, 0.1)',
          }}
        >
          <Stack direction="row" spacing={0.85} alignItems="center" sx={{ mb: hero.life_state === 'dead' ? 0 : 0.7 }}>
            <DndSkullIcon size={19} sx={{ color: '#f08a8a' }} />
            <Typography sx={{ color: '#f08a8a', fontSize: '0.88rem', fontWeight: 950, flex: 1 }}>
              {hero.life_state === 'dead'
                ? 'Герой мёртв'
                : hero.life_state === 'stable'
                  ? 'Без сознания, стабилен'
                  : 'При смерти'}
            </Typography>
          </Stack>
          {hero.life_state === 'dead' ? null : (
            <Stack spacing={0.45}>
              {(
                [
                  ['Успехи', hero.death_saves.successes, '#5bb87a'],
                  ['Провалы', hero.death_saves.failures, '#e05252'],
                ] as const
              ).map(([label, value, color]) => (
                <Stack key={label} direction="row" spacing={0.5} alignItems="center">
                  <Typography
                    sx={{ width: 62, color: 'var(--morius-text-secondary)', fontSize: '0.7rem', fontWeight: 800 }}
                  >
                    {label}
                  </Typography>
                  {[0, 1, 2].map((slot) => (
                    <Box
                      key={slot}
                      sx={{
                        width: 13,
                        height: 13,
                        borderRadius: '50%',
                        border: `2px solid ${slot < value ? color : 'color-mix(in srgb, var(--morius-card-border) 80%, transparent)'}`,
                        backgroundColor: slot < value ? color : 'transparent',
                        transition: 'background-color 280ms ease, border-color 280ms ease',
                      }}
                    />
                  ))}
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
      ) : null}

      {/* --- Health -------------------------------------------------------------------- */}
      <Box sx={cardSx}>
        <Stack direction="row" spacing={0.85} alignItems="center" sx={{ mb: 0.7 }}>
          <DndHeartIcon size={19} sx={{ color: hpColor }} />
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.9rem', fontWeight: 900, flex: 1 }}>
            Здоровье
          </Typography>
          <Typography sx={{ color: hpColor, fontSize: '0.84rem', fontWeight: 950 }}>
            {hp.current}
            <Box component="span" sx={{ color: 'var(--morius-text-secondary)', fontWeight: 800 }}>
              {' / '}
              {hp.max}
            </Box>
            {hp.temp > 0 ? (
              <Box component="span" sx={{ color: '#4c8dff', fontWeight: 900 }}> +{hp.temp}</Box>
            ) : null}
          </Typography>
        </Stack>
        <Box
          sx={{
            position: 'relative',
            height: 11,
            borderRadius: '999px',
            overflow: 'hidden',
            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 68%, #000 32%)',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              insetBlock: 0,
              left: 0,
              width: `${Math.round(ratio * 100)}%`,
              borderRadius: '999px',
              backgroundColor: hpColor,
              backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.24), rgba(0,0,0,0.12))',
              transition: 'width 520ms cubic-bezier(0.22, 1, 0.36, 1), background-color 420ms ease',
            }}
          />
          {hp.temp > 0 ? (
            <Box
              sx={{
                position: 'absolute',
                insetBlock: 0,
                left: `${Math.round(ratio * 100)}%`,
                width: `${Math.min(100 - Math.round(ratio * 100), Math.round(healthRatio(hp.temp, hp.max) * 100))}%`,
                backgroundColor: 'rgba(76, 141, 255, 0.7)',
                transition: 'width 520ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            />
          ) : null}
        </Box>
      </Box>

      {/* --- Sky: time of day + weather -------------------------------------------------- */}
      <Box
        sx={{
          borderRadius: '16px',
          overflow: 'hidden',
          border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 70%, transparent)',
          position: 'relative',
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(160deg, ${skyFrom} 0%, ${skyTo} 100%)`,
            transition: 'background 900ms ease',
          }}
        />
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, backgroundColor: overlay, transition: 'background-color 900ms ease' }} />
        {/* A couple of drifting highlights so the card reads as sky rather than a flat swatch. */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            opacity: 0.5,
            backgroundImage:
              'radial-gradient(60% 40% at 18% 26%, rgba(255,255,255,0.22), transparent 70%), radial-gradient(48% 34% at 78% 68%, rgba(255,255,255,0.14), transparent 72%)',
            animation: 'morius-dnd-sky-drift 18s ease-in-out infinite alternate',
            '@keyframes morius-dnd-sky-drift': {
              from: { transform: 'translate3d(-3%, 0, 0) scale(1)' },
              to: { transform: 'translate3d(3%, -2%, 0) scale(1.06)' },
            },
          }}
        />
        <Box sx={{ position: 'relative', p: 1.15 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Stack direction="row" spacing={0.55} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
              <DndTimeIcon timeOfDay={environment.time_of_day} size={22} sx={{ color: skyTextColor }} />
              <Stack spacing={0} sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ color: skyTextColor, fontSize: '0.92rem', fontWeight: 950, lineHeight: 1.15 }}>
                  {DND_TIME_LABELS[environment.time_of_day] ?? environment.time_of_day}
                </Typography>
                <Typography
                  noWrap
                  sx={{ color: skyTextColor, opacity: 0.76, fontSize: '0.68rem', fontWeight: 800, lineHeight: 1.25 }}
                >
                  {DND_SEASON_LABELS[environment.season] ?? environment.season} · день {environment.day}
                </Typography>
              </Stack>
            </Stack>
            <Stack direction="row" spacing={0.55} alignItems="center" sx={{ minWidth: 0 }}>
              <Stack spacing={0} sx={{ minWidth: 0, alignItems: 'flex-end' }}>
                <Typography noWrap sx={{ color: skyTextColor, fontSize: '0.92rem', fontWeight: 950, lineHeight: 1.15 }}>
                  {DND_WEATHER_LABELS[environment.weather] ?? environment.weather}
                </Typography>
                {environment.weather_note ? (
                  <Typography
                    noWrap
                    sx={{ color: skyTextColor, opacity: 0.76, fontSize: '0.68rem', fontWeight: 700, lineHeight: 1.25, maxWidth: 118 }}
                  >
                    {environment.weather_note}
                  </Typography>
                ) : null}
              </Stack>
              <DndWeatherIcon weather={environment.weather} size={24} sx={{ color: skyTextColor }} />
            </Stack>
          </Stack>
          {environmentEditable ? (
            <Button
              onClick={onOpenEnvironment}
              fullWidth
              sx={{
                mt: 0.9,
                minHeight: 30,
                borderRadius: '9px',
                textTransform: 'none',
                fontSize: '0.74rem',
                fontWeight: 900,
                color: skyTextColor,
                backgroundColor: isDarkTimeOfDay(environment.time_of_day) ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)',
                '&:hover': {
                  backgroundColor: isDarkTimeOfDay(environment.time_of_day) ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.2)',
                },
              }}
            >
              {environment.locked ? 'Изменить (песочница)' : 'Настроить старт'}
            </Button>
          ) : (
            <Typography
              sx={{ mt: 0.75, color: skyTextColor, opacity: 0.66, fontSize: '0.67rem', fontWeight: 700, lineHeight: 1.3 }}
            >
              Дальше временем управляет мастер
            </Typography>
          )}
        </Box>
      </Box>

      {/* --- Conditions ------------------------------------------------------------------ */}
      {buffs.length || debuffs.length ? (
        <Box sx={cardSx}>
          <Typography
            sx={{
              color: 'var(--morius-text-secondary)',
              fontSize: '0.66rem',
              fontWeight: 900,
              letterSpacing: '0.06em',
              mb: 0.6,
            }}
          >
            СОСТОЯНИЯ
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {[...buffs, ...debuffs].map((condition) => {
              const isBuff = condition.kind === 'buff'
              return (
                <Tooltip
                  key={condition.id}
                  disableInteractive
                  title={`${condition.label}: ${condition.note || condition.description}`}
                >
                  <Stack
                    direction="row"
                    spacing={0.4}
                    alignItems="center"
                    sx={{
                      px: 0.6,
                      py: 0.35,
                      borderRadius: '9px',
                      border: `var(--morius-border-width) solid ${isBuff ? 'rgba(91, 184, 122, 0.42)' : 'rgba(224, 82, 82, 0.42)'}`,
                      backgroundColor: isBuff ? 'rgba(91, 184, 122, 0.14)' : 'rgba(224, 82, 82, 0.13)',
                      color: isBuff ? '#7fd39c' : '#f08a8a',
                    }}
                  >
                    <DndConditionIcon icon={condition.icon} size={15} />
                    <Typography sx={{ color: 'inherit', fontSize: '0.7rem', fontWeight: 900, lineHeight: 1 }}>
                      {condition.label}
                    </Typography>
                  </Stack>
                </Tooltip>
              )
            })}
          </Stack>
        </Box>
      ) : null}

      {/* --- Play mode ------------------------------------------------------------------- */}
      {/* A decision about what kind of game this is, taken once before it starts. Flipping it
          mid-story would let a character the world has already reacted to be rewritten, so
          after the first turn it stops being an option and becomes a label. */}
      {state.turn_count === 0 ? (
        <Box sx={cardSx}>
          <Typography
            sx={{
              color: 'var(--morius-text-secondary)',
              fontSize: '0.66rem',
              fontWeight: 900,
              letterSpacing: '0.06em',
              mb: 0.6,
            }}
          >
            РЕЖИМ ИГРЫ
          </Typography>
          <Stack
            direction="row"
            spacing={0.4}
            sx={{
              p: 0.35,
              borderRadius: '12px',
              backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, transparent)',
            }}
          >
            {(['game', 'sandbox'] as const).map((mode) => {
              const active = state.play_mode === mode
              return (
                <Button
                  key={mode}
                  onClick={() => onChangePlayMode(mode)}
                  sx={{
                    flex: 1,
                    minHeight: 32,
                    borderRadius: '9px',
                    textTransform: 'none',
                    fontSize: '0.76rem',
                    fontWeight: 900,
                    color: active ? '#11070A !important' : 'var(--morius-text-secondary) !important',
                    backgroundColor: active
                      ? mode === 'sandbox'
                        ? '#f0c24a'
                        : 'var(--morius-accent)'
                      : 'transparent',
                    '&:hover': {
                      backgroundColor: active
                        ? mode === 'sandbox'
                          ? '#f0c24a'
                          : 'var(--morius-accent)'
                        : 'color-mix(in srgb, var(--morius-accent) 16%, transparent)',
                    },
                  }}
                >
                  {mode === 'game' ? 'Обычный' : 'Песочница'}
                </Button>
              )
            })}
          </Stack>
          <Typography
            sx={{ mt: 0.6, color: 'var(--morius-text-secondary)', fontSize: '0.74rem', lineHeight: 1.4 }}
          >
            {isSandbox
              ? 'Песочница: характеристики, деньги, уровень и NPC меняются в любой момент. Опыт и задания идут своим чередом. Выбирается один раз — до первого хода.'
              : 'Обычный: строгие правила D&D 5e. После первого хода лист фиксируется, дальше героя ведёт история. Выбирается один раз — до первого хода.'}
          </Typography>
        </Box>
      ) : null}

      <Button onClick={onOpenSheet} sx={{ ...sectionButtonSx, minHeight: 40, fontSize: '0.82rem', fontWeight: 900 }}>
        Открыть лист персонажа
      </Button>
    </Stack>
  )
}
