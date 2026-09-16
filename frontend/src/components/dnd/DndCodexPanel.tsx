// The codex: the d20 tab in the right rail.
//
// Four things a table keeps on a notepad — where we are, what we owe people, what the master
// wants us to remember, and who we have met. Characters currently in the scene float to the
// top with their relationship, hit points and level shown inline; everybody else is a list
// you can open.

import {
  Box,
  Button,
  Collapse,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import type {
  DndCatalog,
  DndCurrencyId,
  DndDifficulty,
  DndNpc,
  DndRollPolicy,
  DndState,
} from '../../types/story'
import BaseDialog from '../dialogs/BaseDialog'
import {
  DND_ABILITY_ORDER,
  DND_ABILITY_SHORT,
  DND_MOOD_LABELS,
  DND_RELATION_LABELS,
  abilityModifier,
  formatModifier,
  healthColor,
  healthRatio,
  moodColor,
  relationColor,
} from './dndDisplay'
import {
  DndConditionIcon,
  DndCoinIcon,
  DndD20Icon,
  DndLockIcon,
  DndPeopleIcon,
  DndPinIcon,
  DndScrollIcon,
  DndSheetIcon,
  DndStarIcon,
} from './DndIcons'

// Both the quest list and the note list grow for the whole campaign. Capping their height
// and letting them scroll keeps the panel's other sections reachable on a laptop screen.
const scrollAreaSx = {
  maxHeight: 216,
  overflowY: 'auto',
  pr: 0.4,
  // The rail's own thin scrollbar treatment, so a scrolling card does not read as a
  // different kind of surface from the ones around it.
  scrollbarWidth: 'thin',
  '&::-webkit-scrollbar': { width: 6 },
  '&::-webkit-scrollbar-thumb': {
    borderRadius: 999,
    backgroundColor: 'color-mix(in srgb, var(--morius-accent) 38%, transparent)',
  },
} as const

const ROLL_POLICY_OPTIONS: { id: DndRollPolicy; label: string }[] = [
  { id: 'story', label: 'Живой отыгрыш' },
  { id: 'strict', label: 'Жёсткие правила' },
]

// Green through red, so the row reads as a scale at a glance without needing the labels.
const DIFFICULTY_COLORS: Record<DndDifficulty, string> = {
  easy: '#5bb87a',
  normal: 'var(--morius-accent)',
  hard: '#e0a93f',
  deadly: '#e05252',
}

const FALLBACK_CURRENCIES: { id: DndCurrencyId; label: string }[] = [
  { id: 'fantasy', label: 'Фэнтези' },
  { id: 'modern', label: 'Современность' },
  { id: 'cyberpunk', label: 'Киберпанк' },
]

const FALLBACK_DIFFICULTIES: {
  id: DndDifficulty
  label: string
  dc_shift: number
  hero_bonus: number
  description: string
}[] = [
  { id: 'easy', label: 'Лёгкая', dc_shift: -3, hero_bonus: 2, description: 'Мир снисходителен, герой везучий.' },
  { id: 'normal', label: 'Обычная', dc_shift: 0, hero_bonus: 0, description: 'Чистые правила 5e без поправок.' },
  { id: 'hard', label: 'Сложная', dc_shift: 3, hero_bonus: 0, description: 'Мир требователен, ошибки стоят дорого.' },
  { id: 'deadly', label: 'Смертельная', dc_shift: 5, hero_bonus: -1, description: 'Выживание не подразумевается.' },
]

export type DndCodexPanelProps = {
  state: DndState | null
  catalog: DndCatalog | null
  locationLabel: string
  loading?: boolean
  error?: string
  busyNpcKey?: string | null
  resolveNpcAvatar: (worldCardId: number | null) => string | null
  onMeetNpc: (npc: DndNpc) => void
  onSaveNpc: (npcKey: string, update: Record<string, unknown>) => void
  onSuggestNpcStats: (npcKey: string) => void
  onChangeRollPolicy: (policy: DndRollPolicy) => void
  onChangeDifficulty: (difficulty: DndDifficulty) => void
  onChangeCurrency: (currency: DndCurrencyId) => void
}

const cardSx = {
  borderRadius: '15px',
  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 74%, transparent)',
  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 92%, #050507 8%)',
  p: 1.1,
} as const

function SectionHeading({ icon, title, count }: { icon: React.ReactNode; title: string; count?: string }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.7} sx={{ mb: 0.7 }}>
      <Box sx={{ display: 'inline-flex', color: 'var(--morius-accent)' }}>{icon}</Box>
      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.88rem', fontWeight: 950, flex: 1 }}>
        {title}
      </Typography>
      {count ? (
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem', fontWeight: 800 }}>
          {count}
        </Typography>
      ) : null}
    </Stack>
  )
}

// A relationship meter, centred on neutral. Without it the only visible signal was the band
// label, which does not move for a long time -- so "-4 for lying to her" looked exactly like
// "nothing happened", and the row's green health bar right underneath read as if the
// relationship itself were full and fine.
function RelationBar({ score, color }: { score: number; color: string }) {
  const clamped = Math.max(-100, Math.min(100, Math.round(score)))
  const magnitude = Math.abs(clamped) / 2 // half the track is one direction
  return (
    <Tooltip disableInteractive title={`Отношение: ${clamped > 0 ? '+' : ''}${clamped} из 100`}>
      <Box
        sx={{
          position: 'relative',
          height: 5,
          borderRadius: '999px',
          backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 58%, #000 42%)',
        }}
      >
        {/* The midline is the anchor: it is what makes "slightly negative" legible at a
            glance instead of looking like a nearly-empty bar. */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            insetBlock: -1,
            left: '50%',
            width: '1px',
            backgroundColor: 'color-mix(in srgb, var(--morius-text-secondary) 52%, transparent)',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            insetBlock: 0,
            left: clamped >= 0 ? '50%' : `${50 - magnitude}%`,
            width: `${magnitude}%`,
            borderRadius: '999px',
            backgroundColor: color,
            transition: 'width 480ms cubic-bezier(0.22, 1, 0.36, 1), left 480ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </Box>
    </Tooltip>
  )
}


function HealthBar({ current, max }: { current: number; max: number }) {
  const ratio = healthRatio(current, max)
  return (
    <Box
      sx={{
        position: 'relative',
        height: 6,
        borderRadius: '999px',
        overflow: 'hidden',
        backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 60%, #000 40%)',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          insetBlock: 0,
          left: 0,
          width: `${Math.round(ratio * 100)}%`,
          borderRadius: '999px',
          backgroundColor: healthColor(ratio),
          transition: 'width 460ms cubic-bezier(0.22, 1, 0.36, 1), background-color 380ms ease',
        }}
      />
    </Box>
  )
}

function NpcRow({
  npc,
  avatarUrl,
  expanded,
  busy,
  onToggle,
  onMeet,
  onEdit,
  sandbox,
}: {
  npc: DndNpc
  avatarUrl: string | null
  expanded: boolean
  busy: boolean
  onToggle: () => void
  onMeet: () => void
  onEdit: () => void
  sandbox: boolean
}) {
  const relationLabel = DND_RELATION_LABELS[npc.relation] ?? npc.relation
  const color = relationColor(npc.relation)
  const locked = npc.has_appeared && !sandbox
  return (
    <Box
      sx={{
        ...cardSx,
        p: 0,
        overflow: 'hidden',
        borderColor: npc.is_active
          ? 'color-mix(in srgb, var(--morius-accent) 46%, var(--morius-card-border))'
          : 'color-mix(in srgb, var(--morius-card-border) 74%, transparent)',
        backgroundColor: npc.is_active
          ? 'color-mix(in srgb, var(--morius-accent) 8%, var(--morius-elevated-bg) 92%)'
          : 'color-mix(in srgb, var(--morius-elevated-bg) 92%, #050507 8%)',
        transition: 'border-color 240ms ease, background-color 240ms ease',
      }}
    >
      <Button
        onClick={onToggle}
        sx={{
          width: '100%',
          p: 1.05,
          borderRadius: 0,
          textTransform: 'none',
          justifyContent: 'flex-start',
          color: 'var(--morius-title-text)',
          '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 80%, transparent)' },
        }}
      >
        <Stack direction="row" spacing={1} sx={{ width: '100%', minWidth: 0 }} alignItems="flex-start">
          <Box
            sx={{
              width: 44,
              height: 44,
              flexShrink: 0,
              borderRadius: '12px',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: `var(--morius-border-width) solid ${npc.is_active ? color : 'color-mix(in srgb, var(--morius-card-border) 70%, transparent)'}`,
              backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
            }}
          >
            {avatarUrl ? (
              <Box component="img" src={avatarUrl} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Typography sx={{ color, fontSize: '1.2rem', fontWeight: 950 }}>
                {(npc.name || '?').trim().charAt(0).toUpperCase()}
              </Typography>
            )}
          </Box>
          <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0, alignItems: 'stretch' }}>
            <Stack direction="row" alignItems="baseline" spacing={0.6} sx={{ minWidth: 0 }}>
              <Typography
                noWrap
                sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', fontWeight: 950, lineHeight: 1.15, flex: 1, textAlign: 'left' }}
              >
                {npc.name}
              </Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.68rem', fontWeight: 900 }}>
                ур. {npc.level}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.5} alignItems="baseline" sx={{ width: '100%' }}>
              <Typography
                noWrap
                sx={{ color, fontSize: '0.74rem', fontWeight: 900, lineHeight: 1.2, textAlign: 'left' }}
              >
                {relationLabel}
              </Typography>
              {/* The second clock. A character can be in love and furious at the same time,
                  and the panel has to be able to say so without one hiding the other. */}
              {npc.mood && npc.mood !== 'calm' ? (
                <Tooltip disableInteractive title={npc.mood_note || 'Настроение прямо сейчас'}>
                  <Typography
                    noWrap
                    sx={{
                      color: moodColor(npc.mood),
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      lineHeight: 1.2,
                      flex: 1,
                      textAlign: 'left',
                    }}
                  >
                    · {(DND_MOOD_LABELS[npc.mood] ?? npc.mood).toLowerCase()}
                  </Typography>
                </Tooltip>
              ) : (
                <Box sx={{ flex: 1 }} />
              )}
              <Typography
                sx={{
                  color: 'var(--morius-text-secondary)',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  lineHeight: 1.2,
                }}
              >
                {npc.relation_score > 0 ? '+' : ''}
                {npc.relation_score}
              </Typography>
            </Stack>
            <RelationBar score={npc.relation_score} color={color} />
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ width: '100%' }}>
              <Typography
                sx={{
                  color: 'var(--morius-text-secondary)',
                  fontSize: '0.62rem',
                  fontWeight: 800,
                  lineHeight: 1,
                  minWidth: 26,
                }}
              >
                Хиты
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <HealthBar current={npc.hp.current} max={npc.hp.max} />
              </Box>
            </Stack>
            {npc.role || npc.aliases?.length ? (
              <Typography
                noWrap
                sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.7rem', fontWeight: 700, textAlign: 'left' }}
              >
                {npc.role}
                {npc.aliases?.length ? `${npc.role ? ' · ' : ''}ранее «${npc.aliases[0]}»` : ''}
              </Typography>
            ) : null}
          </Stack>
        </Stack>
      </Button>
      <Collapse in={expanded} timeout={200} unmountOnExit>
        <Stack spacing={0.7} sx={{ px: 1.05, pb: 1.05 }}>
          <Stack direction="row" spacing={0.4} flexWrap="wrap" useFlexGap>
            {DND_ABILITY_ORDER.map((abilityId) => (
              <Box
                key={abilityId}
                sx={{
                  px: 0.55,
                  py: 0.3,
                  borderRadius: '8px',
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 70%, transparent)',
                }}
              >
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.66rem', fontWeight: 900 }}>
                  {DND_ABILITY_SHORT[abilityId]} {npc.abilities[abilityId] ?? 10}
                  <Box component="span" sx={{ color: 'var(--morius-title-text)' }}>
                    {' '}
                    {formatModifier(abilityModifier(npc.abilities[abilityId]))}
                  </Box>
                </Typography>
              </Box>
            ))}
          </Stack>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem', fontWeight: 800 }}>
            Хиты {npc.hp.current} / {npc.hp.max} · КД {npc.armor_class}
          </Typography>
          {npc.relation_note ? (
            <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.78rem', lineHeight: 1.4 }}>
              {npc.relation_note}
            </Typography>
          ) : null}
          {npc.conditions.length ? (
            <Stack direction="row" spacing={0.4} flexWrap="wrap" useFlexGap>
              {npc.conditions.map((condition) => (
                <Tooltip key={condition.id} disableInteractive title={condition.description}>
                  <Stack
                    direction="row"
                    spacing={0.3}
                    alignItems="center"
                    sx={{
                      px: 0.5,
                      py: 0.25,
                      borderRadius: '8px',
                      color: condition.kind === 'buff' ? '#7fd39c' : '#f08a8a',
                      backgroundColor:
                        condition.kind === 'buff' ? 'rgba(91, 184, 122, 0.14)' : 'rgba(224, 82, 82, 0.13)',
                    }}
                  >
                    <DndConditionIcon icon={condition.icon} size={13} />
                    <Typography sx={{ color: 'inherit', fontSize: '0.66rem', fontWeight: 900 }}>
                      {condition.label}
                    </Typography>
                  </Stack>
                </Tooltip>
              ))}
            </Stack>
          ) : null}
          <Stack direction="row" spacing={0.6}>
            <Button
              onClick={onMeet}
              disabled={busy}
              sx={{
                flex: 1,
                minHeight: 34,
                borderRadius: '10px',
                textTransform: 'none',
                fontSize: '0.78rem',
                fontWeight: 900,
                color: '#11070A !important',
                backgroundColor: 'var(--morius-accent) !important',
                '&.Mui-disabled': {
                  color: 'color-mix(in srgb, var(--morius-title-text) 52%, transparent) !important',
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent) !important',
                },
              }}
            >
              Встретиться
            </Button>
            {/* Once a character has walked on stage they belong to the master. Setting their
                lore -- an old enemy who hates the hero on sight, a lover who already adores
                them -- is something you do before the meeting, not during it. */}
            <Tooltip
              disableInteractive
              title={
                locked
                  ? 'Персонаж уже появился в истории — дальше им управляет мастер'
                  : 'Задать характеристики и отношение до первой встречи'
              }
            >
              <span>
                <Button
                  onClick={onEdit}
                  disabled={busy || locked}
                  startIcon={locked ? <DndLockIcon size={14} /> : undefined}
                  sx={{
                    minHeight: 34,
                    px: 1.2,
                    borderRadius: '10px',
                    textTransform: 'none',
                    fontSize: '0.78rem',
                    fontWeight: 900,
                    color: 'var(--morius-title-text) !important',
                    backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 78%, transparent) !important',
                    '&.Mui-disabled': {
                      color: 'color-mix(in srgb, var(--morius-title-text) 46%, transparent) !important',
                    },
                  }}
                >
                  Статы
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Collapse>
    </Box>
  )
}

function NpcStatsDialog({
  npc,
  catalog,
  open,
  busy,
  onClose,
  onSave,
  onSuggest,
}: {
  npc: DndNpc | null
  catalog: DndCatalog | null
  open: boolean
  busy: boolean
  onClose: () => void
  onSave: (update: Record<string, unknown>) => void
  onSuggest: () => void
}) {
  const [draft, setDraft] = useState<DndNpc | null>(npc)

  // Re-seed when a different character is opened, or when the AI suggestion comes back and
  // replaces the numbers under the open dialog. Keyed on the values the suggestion changes so
  // typing is never interrupted by an unrelated state refresh.
  const seedKey = npc ? `${npc.key}:${npc.stats_source}:${npc.level}:${npc.hp.max}:${npc.armor_class}` : ''
  useEffect(() => {
    if (npc) {
      setDraft(npc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey])

  if (!draft) {
    return null
  }

  const update = (patch: Partial<DndNpc>) => setDraft((previous) => (previous ? { ...previous, ...patch } : previous))

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      header={
        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.05rem', fontWeight: 950, pr: 4 }}>
          {draft.name}
        </Typography>
      }
      actions={
        <>
          <Button
            onClick={onSuggest}
            disabled={busy}
            sx={{ textTransform: 'none', color: 'var(--morius-accent) !important', fontWeight: 900, mr: 'auto' }}
          >
            Подобрать ИИ · 1 сол
          </Button>
          <Button
            onClick={onClose}
            disabled={busy}
            sx={{ textTransform: 'none', color: 'var(--morius-text-secondary) !important', fontWeight: 800 }}
          >
            Отмена
          </Button>
          <Button
            onClick={() =>
              onSave({
                role: draft.role,
                relation: draft.relation,
                relation_note: draft.relation_note,
                level: draft.level,
                abilities: draft.abilities,
                hp_max: draft.hp.max,
                hp_current: draft.hp.current,
                armor_class: draft.armor_class,
                notes: draft.notes,
              })
            }
            disabled={busy}
            sx={{
              minHeight: 40,
              px: 1.8,
              borderRadius: '11px',
              textTransform: 'none',
              fontWeight: 950,
              color: '#11070A !important',
              // BaseDialog flattens `background-color` on every button it contains so plain
              // dialog actions read as text. A gradient paints `background-image` instead,
              // which that rule does not touch -- the same trick the other dialogs use.
              backgroundImage: 'var(--morius-accent) !important',
            }}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <Stack spacing={1.1}>
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.45 }}>
          Характеристики NPC ведёт мастер, пока вы не поменяли их вручную. Архимаг или глава гильдии должны быть
          сильными — задайте уровень сами, и система перестанет его понижать.
        </Typography>
        <TextField
          label="Роль"
          value={draft.role}
          onChange={(event) => update({ role: event.target.value })}
          fullWidth
          inputProps={{ maxLength: 80 }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '11px' } }}
        />
        <Stack direction="row" spacing={1}>
          <TextField
            select
            label="Отношение"
            value={draft.relation}
            onChange={(event) => update({ relation: event.target.value })}
            fullWidth
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '11px' } }}
          >
            {(catalog?.relations ?? []).map((relation) => (
              <MenuItem key={relation.id} value={relation.id}>
                {relation.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Уровень"
            type="number"
            value={draft.level}
            onChange={(event) => update({ level: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })}
            sx={{ width: 110, '& .MuiOutlinedInput-root': { borderRadius: '11px' } }}
          />
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField
            label="Хиты (макс.)"
            type="number"
            value={draft.hp.max}
            onChange={(event) =>
              update({ hp: { ...draft.hp, max: Math.max(1, Math.min(9999, Number(event.target.value) || 1)) } })
            }
            fullWidth
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '11px' } }}
          />
          <TextField
            label="Хиты (сейчас)"
            type="number"
            value={draft.hp.current}
            onChange={(event) =>
              update({ hp: { ...draft.hp, current: Math.max(0, Math.min(9999, Number(event.target.value) || 0)) } })
            }
            fullWidth
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '11px' } }}
          />
          <TextField
            label="КД"
            type="number"
            value={draft.armor_class}
            onChange={(event) => update({ armor_class: Math.max(1, Math.min(40, Number(event.target.value) || 10)) })}
            sx={{ flex: '0 0 96px', '& .MuiOutlinedInput-root': { borderRadius: '11px' } }}
          />
        </Stack>
        {/* Six fields in a three-column grid: two even rows instead of a five-plus-one wrap
            that reads as a mistake at narrow widths. */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0.8 }}>
          {DND_ABILITY_ORDER.map((abilityId) => (
            <TextField
              key={abilityId}
              label={DND_ABILITY_SHORT[abilityId]}
              type="number"
              value={draft.abilities[abilityId] ?? 10}
              onChange={(event) =>
                update({
                  abilities: {
                    ...draft.abilities,
                    [abilityId]: Math.max(1, Math.min(30, Number(event.target.value) || 10)),
                  },
                })
              }
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '11px' } }}
            />
          ))}
        </Box>
        <TextField
          label="Заметка мастера"
          value={draft.notes}
          onChange={(event) => update({ notes: event.target.value })}
          fullWidth
          multiline
          minRows={2}
          maxRows={5}
          inputProps={{ maxLength: 600 }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '11px' } }}
        />
        {busy ? <LinearProgress sx={{ borderRadius: '999px' }} /> : null}
      </Stack>
    </BaseDialog>
  )
}

export default function DndCodexPanel({
  state,
  catalog,
  locationLabel,
  loading = false,
  error = '',
  busyNpcKey = null,
  resolveNpcAvatar,
  onMeetNpc,
  onSaveNpc,
  onSuggestNpcStats,
  onChangeRollPolicy,
  onChangeDifficulty,
  onChangeCurrency,
}: DndCodexPanelProps) {
  const [expandedNpcKey, setExpandedNpcKey] = useState<string | null>(null)
  const [statsNpcKey, setStatsNpcKey] = useState<string | null>(null)

  const npcs = useMemo(() => state?.npcs ?? [], [state])
  const activeNpcs = useMemo(() => npcs.filter((npc) => npc.is_active), [npcs])
  const otherNpcs = useMemo(() => npcs.filter((npc) => !npc.is_active), [npcs])
  const activeQuests = useMemo(
    () => (state?.quests ?? []).filter((quest) => quest.status === 'active'),
    [state],
  )
  const finishedQuests = useMemo(
    () => (state?.quests ?? []).filter((quest) => quest.status !== 'active'),
    [state],
  )
  const difficultyOptions = useMemo(
    () => (catalog?.difficulties?.length ? catalog.difficulties : FALLBACK_DIFFICULTIES),
    [catalog],
  )
  const currencyOptions = useMemo(
    () => (catalog?.currencies?.length ? catalog.currencies : FALLBACK_CURRENCIES),
    [catalog],
  )
  // Prices get quoted in this money the moment play starts, so it stops being a choice then.
  const setupOpen = (state?.turn_count ?? 0) === 0
  const activeDifficulty = useMemo(
    () => difficultyOptions.find((item) => item.id === (state?.difficulty ?? 'normal')) ?? null,
    [difficultyOptions, state?.difficulty],
  )
  const statsNpc = useMemo(
    () => npcs.find((npc) => npc.key === statsNpcKey) ?? null,
    [npcs, statsNpcKey],
  )

  if (!state) {
    return (
      <Box sx={{ ...cardSx, textAlign: 'center', py: 2.4 }}>
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.86rem', fontWeight: 700 }}>
          {loading ? 'Загружаем партию…' : error || 'Данные партии недоступны'}
        </Typography>
      </Box>
    )
  }

  return (
    <Stack spacing={1.15}>
      {error ? (
        <Typography sx={{ color: '#e07a7a', fontSize: '0.78rem', fontWeight: 800 }}>{error}</Typography>
      ) : null}

      {/* --- Table settings ------------------------------------------------------------- */}
      {/* Two dials that change how the game feels rather than what it contains, so they live
          here on the dice tab instead of in the character sheet. The first decides how often
          a die comes out at all; the second decides how hard the world pushes back. */}
      <Box sx={cardSx}>
        <SectionHeading icon={<DndD20Icon size={17} />} title="Правила стола" />

        <Typography
          sx={{
            color: 'var(--morius-text-secondary)',
            fontSize: '0.66rem',
            fontWeight: 900,
            letterSpacing: '0.05em',
            mb: 0.5,
          }}
        >
          КОГДА БРОСАТЬ КУБИК
        </Typography>
        <Stack
          direction="row"
          spacing={0.4}
          sx={{
            p: 0.35,
            mb: 0.4,
            borderRadius: '12px',
            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, transparent)',
          }}
        >
          {ROLL_POLICY_OPTIONS.map((option) => {
            const isActive = (state.roll_policy ?? 'story') === option.id
            return (
              <Button
                key={option.id}
                onClick={() => onChangeRollPolicy(option.id)}
                sx={{
                  flex: 1,
                  minHeight: 32,
                  borderRadius: '9px',
                  textTransform: 'none',
                  fontSize: '0.76rem',
                  fontWeight: 900,
                  color: isActive ? '#11070A !important' : 'var(--morius-text-secondary) !important',
                  backgroundColor: isActive ? 'var(--morius-accent)' : 'transparent',
                  '&:hover': {
                    backgroundColor: isActive
                      ? 'var(--morius-accent)'
                      : 'color-mix(in srgb, var(--morius-accent) 16%, transparent)',
                  },
                }}
              >
                {option.label}
              </Button>
            )
          })}
        </Stack>
        <Typography
          sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.75rem', lineHeight: 1.4, mb: 1.1 }}
        >
          {(state.roll_policy ?? 'story') === 'strict'
            ? 'Жёсткие правила: почти любое спорное действие идёт через кубик, включая первую попытку уговорить или соврать.'
            : 'Живой отыгрыш: разговор мастер ведёт по характеру персонажа, а кубик выходит, когда вы давите после отказа или рискуете по-настоящему.'}
        </Typography>

        <Typography
          sx={{
            color: 'var(--morius-text-secondary)',
            fontSize: '0.66rem',
            fontWeight: 900,
            letterSpacing: '0.05em',
            mb: 0.5,
          }}
        >
          СЛОЖНОСТЬ
        </Typography>
        <Stack
          direction="row"
          spacing={0.35}
          sx={{
            p: 0.35,
            mb: 0.4,
            borderRadius: '12px',
            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, transparent)',
          }}
        >
          {difficultyOptions.map((option) => {
            const isActive = (state.difficulty ?? 'normal') === option.id
            return (
              <Tooltip key={option.id} disableInteractive title={option.description}>
                <Button
                  onClick={() => onChangeDifficulty(option.id)}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 30,
                    px: 0.4,
                    borderRadius: '9px',
                    textTransform: 'none',
                    fontSize: '0.7rem',
                    fontWeight: 900,
                    color: isActive ? '#11070A !important' : 'var(--morius-text-secondary) !important',
                    backgroundColor: isActive ? DIFFICULTY_COLORS[option.id] : 'transparent',
                    '&:hover': {
                      backgroundColor: isActive
                        ? DIFFICULTY_COLORS[option.id]
                        : `color-mix(in srgb, ${DIFFICULTY_COLORS[option.id]} 22%, transparent)`,
                    },
                  }}
                >
                  {option.label}
                </Button>
              </Tooltip>
            )
          })}
        </Stack>
        {setupOpen ? (
          <>
            <Typography
              sx={{
                color: 'var(--morius-text-secondary)',
                fontSize: '0.66rem',
                fontWeight: 900,
                letterSpacing: '0.05em',
                mt: 1.1,
                mb: 0.5,
              }}
            >
              ВАЛЮТА МИРА
            </Typography>
            <Stack
              direction="row"
              spacing={0.35}
              sx={{
                p: 0.35,
                mb: 0.4,
                borderRadius: '12px',
                backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, transparent)',
              }}
            >
              {currencyOptions.map((option) => {
                const isActive = (state.currency ?? 'fantasy') === option.id
                return (
                  <Button
                    key={option.id}
                    onClick={() => onChangeCurrency(option.id)}
                    startIcon={isActive ? <DndCoinIcon size={14} /> : undefined}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      minHeight: 30,
                      px: 0.4,
                      borderRadius: '9px',
                      textTransform: 'none',
                      fontSize: '0.7rem',
                      fontWeight: 900,
                      color: isActive ? '#11070A !important' : 'var(--morius-text-secondary) !important',
                      backgroundColor: isActive ? '#e0c05a' : 'transparent',
                      '&:hover': {
                        backgroundColor: isActive ? '#e0c05a' : 'rgba(224, 192, 90, 0.18)',
                      },
                    }}
                  >
                    {option.label.split('—')[0].trim()}
                  </Button>
                )
              })}
            </Stack>
            <Typography
              sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.75rem', lineHeight: 1.4, mb: 1.1 }}
            >
              Мелкие траты считаются по номиналам и дают сдачу. Выбирается до первого хода.
            </Typography>
          </>
        ) : null}

        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.75rem', lineHeight: 1.4 }}>
          {activeDifficulty
            ? `${activeDifficulty.description}${
                activeDifficulty.dc_shift || activeDifficulty.hero_bonus
                  ? ` (${[
                      activeDifficulty.dc_shift
                        ? `сложность ${activeDifficulty.dc_shift > 0 ? '+' : ''}${activeDifficulty.dc_shift}`
                        : '',
                      activeDifficulty.hero_bonus
                        ? `к броскам героя ${activeDifficulty.hero_bonus > 0 ? '+' : ''}${activeDifficulty.hero_bonus}`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(', ')})`
                  : ''
              }`
            : 'Чистые правила 5e без поправок.'}
        </Typography>
      </Box>

      {/* --- Place --------------------------------------------------------------------- */}
      <Box sx={cardSx}>
        <SectionHeading icon={<DndPinIcon size={17} />} title="Место" />
        <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.86rem', lineHeight: 1.45, fontWeight: 700 }}>
          {locationLabel || 'Действие ещё не привязано к месту'}
        </Typography>
      </Box>

      {/* --- Quests -------------------------------------------------------------------- */}
      {/* A quest is a promise the player made, so it reads as a checklist: a marker you can
          scan down, the goal in bold, the small print under it. Finished ones stay visible
          but stop competing for attention. */}
      <Box sx={cardSx}>
        <SectionHeading
          icon={<DndScrollIcon size={17} />}
          title="Активные задания"
          count={activeQuests.length ? String(activeQuests.length) : undefined}
        />
        {activeQuests.length ? (
          <Stack spacing={0.5} sx={scrollAreaSx}>
            {activeQuests.map((quest) => (
              <Stack
                key={quest.title}
                direction="row"
                spacing={0.7}
                sx={{
                  px: 0.85,
                  py: 0.7,
                  borderRadius: '11px',
                  borderLeft: '3px solid var(--morius-accent)',
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 76%, transparent)',
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    mt: '5px',
                    width: 6,
                    height: 6,
                    flexShrink: 0,
                    borderRadius: '50%',
                    border: '2px solid var(--morius-accent)',
                  }}
                />
                <Stack spacing={0.15} sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{ color: 'var(--morius-title-text)', fontSize: '0.84rem', fontWeight: 900, lineHeight: 1.3 }}
                  >
                    {quest.title}
                  </Typography>
                  {quest.detail ? (
                    <Typography
                      sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.77rem', lineHeight: 1.4 }}
                    >
                      {quest.detail}
                    </Typography>
                  ) : null}
                </Stack>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
            Заданий пока нет — их отмечает мастер по ходу истории
          </Typography>
        )}
        {finishedQuests.length ? (
          <Stack
            spacing={0.35}
            sx={{
              mt: 0.85,
              pt: 0.7,
              borderTop: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 60%, transparent)',
            }}
          >
            {finishedQuests.map((quest) => (
              <Stack key={quest.title} direction="row" spacing={0.55} alignItems="center">
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    color: quest.status === 'done' ? '#5bb87a' : '#e0a93f',
                    fontSize: '0.8rem',
                    fontWeight: 950,
                    lineHeight: 1,
                  }}
                >
                  {quest.status === 'done' ? '✓' : '✕'}
                </Box>
                <Typography
                  noWrap
                  sx={{
                    color: 'var(--morius-text-secondary)',
                    fontSize: '0.76rem',
                    fontWeight: 800,
                    textDecoration: 'line-through',
                    textDecorationColor: 'color-mix(in srgb, currentColor 44%, transparent)',
                  }}
                >
                  {quest.title}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ) : null}
      </Box>

      {/* --- Master notes --------------------------------------------------------------- */}
      {/* Newest first, each stamped with the turn it came from, and the whole list scrolls:
          the master accumulates these forever and an unbounded column pushed the character
          list off the screen entirely. */}
      <Box sx={cardSx}>
        <SectionHeading
          icon={<DndSheetIcon size={17} />}
          title="Заметки мастера"
          count={state.notes.length ? String(state.notes.length) : undefined}
        />
        {state.notes.length ? (
          <Stack spacing={0.45} sx={scrollAreaSx}>
            {state.notes.map((note, index) => (
              <Stack
                key={`${note.turn}-${index}`}
                direction="row"
                spacing={0.7}
                sx={{
                  px: 0.85,
                  py: 0.6,
                  borderRadius: '10px',
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 70%, transparent)',
                }}
              >
                {note.turn > 0 ? (
                  <Tooltip disableInteractive title={`Ход ${note.turn}`}>
                    <Typography
                      sx={{
                        flexShrink: 0,
                        minWidth: 22,
                        color: 'var(--morius-accent)',
                        fontSize: '0.66rem',
                        fontWeight: 950,
                        lineHeight: 1.7,
                        opacity: 0.85,
                      }}
                    >
                      #{note.turn}
                    </Typography>
                  </Tooltip>
                ) : null}
                <Typography
                  sx={{ color: 'var(--morius-text-primary)', fontSize: '0.79rem', lineHeight: 1.45 }}
                >
                  {note.text}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
            Мастер ещё ничего не отметил
          </Typography>
        )}
      </Box>

      {/* --- Characters ------------------------------------------------------------------ */}
      <Box sx={{ ...cardSx, p: 0, backgroundColor: 'transparent', border: 'none' }}>
        <SectionHeading
          icon={<DndPeopleIcon size={17} />}
          title="Знакомые персонажи"
          count={npcs.length ? `${activeNpcs.length} / ${npcs.length}` : undefined}
        />
        {npcs.length ? (
          <Stack spacing={0.7}>
            {[...activeNpcs, ...otherNpcs].map((npc) => (
              <NpcRow
                key={npc.key}
                npc={npc}
                avatarUrl={resolveNpcAvatar(npc.world_card_id)}
                expanded={expandedNpcKey === npc.key}
                busy={busyNpcKey === npc.key}
                onToggle={() => setExpandedNpcKey((previous) => (previous === npc.key ? null : npc.key))}
                onMeet={() => onMeetNpc(npc)}
                onEdit={() => setStatsNpcKey(npc.key)}
                sandbox={state.play_mode === 'sandbox'}
              />
            ))}
          </Stack>
        ) : (
          <Box sx={cardSx}>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem', lineHeight: 1.45 }}>
              Важные персонажи появятся здесь сами: система заводит карточку на каждого названного NPC, который
              что-то значит для истории, и пропускает случайную массовку.
            </Typography>
          </Box>
        )}
      </Box>

      {/* --- Experience footnote ---------------------------------------------------------- */}
      <Box sx={{ ...cardSx, backgroundColor: 'transparent', borderStyle: 'dashed' }}>
        <Stack direction="row" spacing={0.7} alignItems="center">
          <DndStarIcon size={15} sx={{ color: 'var(--morius-text-secondary)' }} />
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.73rem', lineHeight: 1.4 }}>
            Опыт начисляется за исход сцены: мелкое препятствие, схватка, важная цель, завершённый квест.
          </Typography>
        </Stack>
      </Box>

      <NpcStatsDialog
        npc={statsNpc}
        catalog={catalog}
        open={Boolean(statsNpc)}
        busy={busyNpcKey === statsNpcKey}
        onClose={() => setStatsNpcKey(null)}
        onSave={(update) => {
          if (statsNpcKey) {
            onSaveNpc(statsNpcKey, update)
          }
          setStatsNpcKey(null)
        }}
        onSuggest={() => {
          if (statsNpcKey) {
            onSuggestNpcStats(statsNpcKey)
          }
        }}
      />
    </Stack>
  )
}
