// The character sheet editor.
//
// Two shapes behind one dialog. In "режим игры" the ability scores run through the 5e
// 27-point buy: the steppers refuse to leave 8..15, the budget counter shows what is left,
// and the racial bonus is previewed rather than typed — which is what stops a level 1 hero
// from having an 18 in anything. In "режим песочницы" the same controls open up to 1..30
// with a free level, hit points, armour class and inventory.
//
// Once the character has played a turn the sheet stops being a builder and becomes a record:
// race, class and the ability array are fixed, and skills can only be added into slots a
// level has granted. That lock comes from the server (`state.locks`) rather than being worked
// out here, and the server re-checks every field on save — the greying-out below is for the
// player's benefit, not for safety.

import {
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { DndLockIcon } from './DndIcons'
import { useEffect, useMemo, useState } from 'react'
import type { DndAbilityId, DndCatalog, DndState, StoryWorldCard } from '../../types/story'
import BaseDialog from '../dialogs/BaseDialog'
import DndSurfaceButton from './DndSurfaceButton'
import type { StoryDndHeroInput } from '../../services/storyApi'
import {
  DND_ABILITY_LABELS,
  DND_ABILITY_ORDER,
  DND_ABILITY_SHORT,
  abilityModifier,
  formatModifier,
  labelForClass,
  pointBuyCost,
  pointBuySpent,
  raceBonuses,
} from './dndDisplay'
import { DndShieldIcon, DndHeartIcon, DndStarIcon } from './DndIcons'

export type DndCharacterSheetDialogProps = {
  open: boolean
  state: DndState | null
  catalog: DndCatalog | null
  mainHeroCards: StoryWorldCard[]
  // The card the player actually chose to play as, or null when they chose none. Never a
  // "first card we found" stand-in: an unpicked hero stays unpicked.
  activeHeroCard: StoryWorldCard | null
  resolveCardAvatar: (card: StoryWorldCard) => string | null
  saving: boolean
  error: string
  onClose: () => void
  onSave: (hero: StoryDndHeroInput) => void
  onReset: () => void
}

const DEFAULT_BASE: Record<DndAbilityId, number> = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }

const fieldSx = {
  '& .MuiOutlinedInput-root': { borderRadius: '12px' },
} as const

function SectionTitle({ children, hint }: { children: string; hint?: string }) {
  return (
    <Stack direction="row" alignItems="baseline" spacing={0.85} sx={{ mt: 0.4 }}>
      <Typography
        sx={{
          color: 'var(--morius-title-text)',
          fontSize: '0.72rem',
          fontWeight: 950,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {children}
      </Typography>
      {hint ? (
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem', fontWeight: 700 }}>
          {hint}
        </Typography>
      ) : null}
    </Stack>
  )
}

function StepperButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: string
}) {
  return (
    <DndSurfaceButton
      ariaLabel={label}
      disabled={disabled}
      onClick={onClick}
      sx={{
        width: 28,
        height: 28,
        minWidth: 28,
        borderRadius: '9px',
        color: 'var(--morius-title-text)',
        fontSize: '1.05rem',
        fontWeight: 900,
        lineHeight: 1,
      }}
    >
      {children}
    </DndSurfaceButton>
  )
}

export default function DndCharacterSheetDialog({
  open,
  state,
  catalog,
  mainHeroCards,
  activeHeroCard,
  resolveCardAvatar,
  saving,
  error,
  onClose,
  onSave,
  onReset,
}: DndCharacterSheetDialogProps) {
  const isSandbox = state?.play_mode === 'sandbox'
  const locks = state?.locks ?? null
  const identityLocked = Boolean(locks?.identity_locked) && !isSandbox
  const abilitiesLocked = Boolean(locks?.abilities_locked) && !isSandbox
  const skillSlots = locks?.skill_slots ?? state?.hero.skill_slots ?? 6
  // Character creation is open until the story starts; sandbox keeps it open forever.
  const setupOpen = !locks?.started || isSandbox

  const [name, setName] = useState('')
  const [raceId, setRaceId] = useState('human')
  const [classId, setClassId] = useState('fighter')
  const [background, setBackground] = useState('')
  const [backgroundId, setBackgroundId] = useState('')
  const [base, setBase] = useState<Record<DndAbilityId, number>>(DEFAULT_BASE)
  const [skills, setSkills] = useState<string[]>([])
  const [level, setLevel] = useState(1)
  const [hpMax, setHpMax] = useState(10)
  const [hpCurrent, setHpCurrent] = useState(10)
  const [armorClass, setArmorClass] = useState(10)
  const [speed, setSpeed] = useState(30)
  const [purse, setPurse] = useState(0)
  const [inventoryText, setInventoryText] = useState('')
  const [inventoryNote, setInventoryNote] = useState('')
  const [avatarCardId, setAvatarCardId] = useState<number | null>(null)

  const currency = useMemo(
    () => (catalog?.currencies ?? []).find((item) => item.id === (state?.currency ?? 'fantasy')) ?? null,
    [catalog, state?.currency],
  )
  const currencyLabel = currency?.label.split('—')[0].trim() ?? 'Фэнтези'
  const purseDenominations = useMemo(() => currency?.denominations ?? [], [currency])
  const wealthPresets = useMemo(() => {
    if (!currency) {
      return []
    }
    return [
      { id: 'poor', label: 'Бедняк', amount: currency.presets.poor },
      { id: 'normal', label: 'Обычный', amount: currency.presets.normal },
      { id: 'rich', label: 'Богач', amount: currency.presets.rich },
    ]
  }, [currency])
  // The purse is one number; these are the coins it comes to. Editing a coin box rebuilds the
  // number, which is what keeps "3 gold and 4 silver" and "340" the same thing.
  const coinCounts = useMemo(() => {
    const result: Record<string, number> = {}
    let remaining = Math.max(0, purse)
    for (const denomination of purseDenominations) {
      result[denomination.id] = Math.floor(remaining / denomination.value)
      remaining -= result[denomination.id] * denomination.value
    }
    return result
  }, [purse, purseDenominations])
  const purseDisplay = useMemo(() => {
    const parts = purseDenominations
      .map((denomination) => ({ short: denomination.short, count: coinCounts[denomination.id] ?? 0 }))
      .filter((part) => part.count > 0)
    if (!parts.length) {
      return `0 ${purseDenominations[purseDenominations.length - 1]?.short ?? ''}`.trim()
    }
    return parts.map((part) => `${part.count} ${part.short}`).join(' ')
  }, [coinCounts, purseDenominations])
  const handleCoinChange = (denominationId: string, raw: string) => {
    const next = Math.max(0, Math.min(9_999_999, Number(raw) || 0))
    const total = purseDenominations.reduce((sum, denomination) => {
      const count = denomination.id === denominationId ? next : coinCounts[denomination.id] ?? 0
      return sum + count * denomination.value
    }, 0)
    setPurse(total)
  }

  // Re-seed the form when the dialog opens, and again when the play mode changes -- switching
  // to sandbox rewrites the ability basis server-side, so the form has to follow. Deliberately
  // NOT on every state change: a post-turn push would otherwise wipe what the player is typing.
  const seedKey = `${open ? 'open' : 'closed'}:${state?.play_mode ?? 'game'}`
  useEffect(() => {
    if (!open || !state) {
      return
    }
    const hero = state.hero
    setName(hero.name || activeHeroCard?.title || '')
    setRaceId(hero.race)
    setClassId(hero.class)
    setBackground(hero.background)
    setBackgroundId(hero.background_id)
    setBase({ ...DEFAULT_BASE, ...hero.base_abilities })
    setSkills(hero.skill_proficiencies)
    setLevel(hero.level)
    setHpMax(hero.hp.max)
    setHpCurrent(hero.hp.current)
    setArmorClass(hero.armor_class)
    setSpeed(hero.speed)
    setPurse(hero.purse)
    setInventoryText(hero.inventory.join(', '))
    setInventoryNote(hero.inventory_note)
    setAvatarCardId(hero.avatar_world_card_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey])

  const bonuses = useMemo(() => raceBonuses(catalog, raceId), [catalog, raceId])
  const asiAllocation = useMemo(() => state?.hero.asi_allocation ?? {}, [state])
  const spent = useMemo(() => (isSandbox ? null : pointBuySpent(catalog, base)), [catalog, base, isSandbox])
  const budget = catalog?.point_buy.budget ?? 27
  const minScore = isSandbox ? (catalog?.sandbox.min ?? 1) : (catalog?.point_buy.min ?? 8)
  const maxScore = isSandbox ? (catalog?.sandbox.max ?? 30) : (catalog?.point_buy.max ?? 15)
  const overBudget = spent !== null && spent > budget

  const finalScores = useMemo(() => {
    const result = {} as Record<DndAbilityId, number>
    for (const abilityId of DND_ABILITY_ORDER) {
      const asi = Number((asiAllocation as Record<string, number>)[abilityId] ?? 0)
      result[abilityId] = isSandbox
        ? base[abilityId]
        : Math.min(20, base[abilityId] + (bonuses[abilityId] ?? 0) + asi)
    }
    return result
  }, [base, bonuses, isSandbox, asiAllocation])

  const classSkills = useMemo(
    () => catalog?.classes.find((item) => item.id === classId)?.skills ?? [],
    [catalog, classId],
  )

  const canAfford = (abilityId: DndAbilityId, nextScore: number): boolean => {
    if (abilitiesLocked) {
      return false
    }
    if (isSandbox) {
      return nextScore >= minScore && nextScore <= maxScore
    }
    if (nextScore < minScore || nextScore > maxScore) {
      return false
    }
    const candidate = { ...base, [abilityId]: nextScore }
    const candidateSpent = pointBuySpent(catalog, candidate)
    return candidateSpent !== null && candidateSpent <= budget
  }

  // After the first turn a proficiency is something the character *has*: new ones go into the
  // slots a level opened, and nothing already learned can be traded away.
  const lockedSkills = useMemo(
    () => (locks?.started && !isSandbox ? (state?.hero.skill_proficiencies ?? []) : []),
    [isSandbox, locks?.started, state?.hero.skill_proficiencies],
  )

  const toggleSkill = (skillId: string) => {
    if (lockedSkills.includes(skillId)) {
      return
    }
    setSkills((previous) => {
      if (previous.includes(skillId)) {
        return previous.filter((item) => item !== skillId)
      }
      if (previous.length >= skillSlots) {
        return previous
      }
      return [...previous, skillId]
    })
  }

  const handleSave = () => {
    const hero: StoryDndHeroInput = {
      name,
      background,
      background_id: backgroundId,
      skill_proficiencies: skills,
      inventory_note: inventoryNote,
    }
    // A locked sheet does not resubmit the fields it cannot change: sending them unchanged
    // would work, but sending nothing makes it impossible to change them by accident.
    if (!identityLocked) {
      hero.race = raceId
      hero.class = classId
    }
    if (!abilitiesLocked) {
      hero.base_abilities = base
    }
    if (setupOpen) {
      hero.purse = purse
      hero.inventory = inventoryText
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }
    if (avatarCardId) {
      hero.avatar_world_card_id = avatarCardId
    }
    if (isSandbox) {
      hero.level = level
      hero.hp_max = hpMax
      hero.hp_current = hpCurrent
      hero.armor_class = armorClass
      hero.speed = speed
    }
    onSave(hero)
  }

  const derivedHitDie = catalog?.classes.find((item) => item.id === classId)?.hit_die ?? 10
  // The starting kit follows the class picker immediately. Reading it off the saved state
  // meant the panel showed a fighter's chain mail while the dropdown already said "Плут".
  const previewInventory = useMemo(() => {
    if (isSandbox) {
      return []
    }
    const startingKit = catalog?.classes.find((item) => item.id === classId)?.starting_inventory ?? []
    const savedClassId = state?.hero.class
    if (savedClassId === classId && (state?.hero.inventory.length ?? 0) > 0) {
      return state?.hero.inventory ?? []
    }
    return startingKit
  }, [catalog, classId, isSandbox, state?.hero.class, state?.hero.inventory])
  const inventoryIsPreview = !isSandbox && state?.hero.class !== classId
  const selectedBackground = useMemo(
    () => (catalog?.backgrounds ?? []).find((item) => item.id === backgroundId) ?? null,
    [backgroundId, catalog],
  )
  const previewHp = isSandbox
    ? hpMax
    : derivedHitDie + abilityModifier(finalScores.con) + (level - 1) * (Math.floor(derivedHitDie / 2) + 1 + abilityModifier(finalScores.con))

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      header={
        <Stack direction="row" alignItems="center" spacing={1} sx={{ pr: 4 }}>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.15rem', fontWeight: 950, flex: 1 }}>
            Лист персонажа
          </Typography>
        </Stack>
      }
      actions={
        <>
          <Button
            onClick={onReset}
            disabled={saving}
            sx={{ textTransform: 'none', color: '#e07a7a !important', fontWeight: 800, mr: 'auto' }}
          >
            Сбросить
          </Button>
          <Button onClick={onClose} disabled={saving} sx={{ textTransform: 'none', color: 'var(--morius-text-secondary) !important', fontWeight: 800 }}>
            Отмена
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || overBudget}
            sx={{
              textTransform: 'none',
              fontWeight: 950,
              px: 2,
              minHeight: 40,
              borderRadius: '12px',
              color: '#11070A !important',
              background: 'var(--morius-accent) !important',
              '&.Mui-disabled': {
                color: 'color-mix(in srgb, var(--morius-title-text) 52%, transparent) !important',
                background: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, #000 12%) !important',
              },
            }}
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        {/* The play-mode switch lives in the left menu now: it is a one-time decision about
            what kind of game this is, not something to reach for from inside the sheet. */}
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.45 }}>
          {isSandbox
            ? 'Песочница: характеристики от 1 до 30, свободный уровень, хиты и инвентарь — и всё это остаётся доступным для правки в любой момент. Правила игры при этом те же: заявка игрока остаётся попыткой, броски обязательны, NPC ведут себя по своему характеру. Время и погоду вы задаёте сами.'
            : `Режим игры: характеристики по закупке очков D&D 5e (${budget} очков, базовое значение ${minScore}–${maxScore}), расовый бонус сверху. Выше 20 не поднимется никогда, на 1 уровне — не выше 17. После первого хода раса, класс и характеристики фиксируются: дальше персонаж растёт только с уровнем.`}
        </Typography>

        {error ? (
          <Typography sx={{ color: '#e07a7a', fontSize: '0.82rem', fontWeight: 800 }}>{error}</Typography>
        ) : null}

        {/* --- The lock banner, when the character is already in play ------------------ */}
        {identityLocked ? (
          <Stack
            direction="row"
            spacing={0.85}
            alignItems="flex-start"
            sx={{
              px: 1.1,
              py: 0.85,
              borderRadius: '12px',
              border: 'var(--morius-border-width) solid color-mix(in srgb, #f0c24a 34%, transparent)',
              backgroundColor: 'rgba(240, 194, 74, 0.1)',
            }}
          >
            <DndLockIcon size={17} sx={{ color: '#f0c24a', mt: '1px', flexShrink: 0 }} />
            <Typography sx={{ color: 'var(--morius-text-primary)', fontSize: '0.79rem', lineHeight: 1.45 }}>
              {locks?.reason ||
                'Персонаж уже в игре: раса, класс и базовые характеристики зафиксированы.'}
            </Typography>
          </Stack>
        ) : null}

        {/* --- Identity -------------------------------------------------------------- */}
        <SectionTitle>Кто вы</SectionTitle>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          {/* The name belongs to the hero card the player chose. Typing a second one here
              only created a way for the sheet and the story to disagree about who you are. */}
          <TextField
            label="Имя героя"
            value={name}
            onChange={(event) => setName(event.target.value)}
            fullWidth
            disabled={Boolean(activeHeroCard)}
            inputProps={{ maxLength: 80 }}
            sx={fieldSx}
            helperText={
              activeHeroCard
                ? 'Из выбранной карточки главного героя'
                : 'Главный герой не выбран — можно вписать имя вручную'
            }
          />
          <TextField
            select
            label="Предыстория"
            value={backgroundId}
            onChange={(event) => {
              const nextId = event.target.value
              setBackgroundId(nextId)
              const template = (catalog?.backgrounds ?? []).find((item) => item.id === nextId)
              setBackground(template?.label ?? '')
            }}
            fullWidth
            sx={fieldSx}
            helperText={selectedBackground?.summary ?? 'Кем герой был до приключений'}
          >
            <MenuItem value="">Не выбрана</MenuItem>
            {(catalog?.backgrounds ?? []).map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {item.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        {backgroundId ? (
          <TextField
            label="Своя формулировка (необязательно)"
            value={background}
            onChange={(event) => setBackground(event.target.value)}
            fullWidth
            inputProps={{ maxLength: 80 }}
            sx={fieldSx}
          />
        ) : null}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            select
            label="Раса"
            value={raceId}
            onChange={(event) => setRaceId(event.target.value)}
            fullWidth
            disabled={identityLocked}
            sx={fieldSx}
            helperText={
              identityLocked
                ? 'Зафиксирована'
                : Object.entries(bonuses).length
                  ? Object.entries(bonuses)
                      .map(([key, value]) => `${DND_ABILITY_SHORT[key as DndAbilityId]} +${value}`)
                      .join(', ')
                  : ' '
            }
          >
            {(catalog?.races ?? []).map((race) => (
              <MenuItem key={race.id} value={race.id}>
                {race.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Класс"
            value={classId}
            onChange={(event) => {
              setClassId(event.target.value)
              const nextSkills = catalog?.classes.find((item) => item.id === event.target.value)?.skills ?? []
              setSkills(nextSkills.slice(0, skillSlots))
            }}
            fullWidth
            disabled={identityLocked}
            sx={fieldSx}
            helperText={identityLocked ? 'Зафиксирован' : `Кость хитов d${derivedHitDie}`}
          >
            {(catalog?.classes ?? []).map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {item.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {/* --- Abilities -------------------------------------------------------------- */}
        <SectionTitle
          hint={
            abilitiesLocked
              ? 'зафиксированы — растут только с уровнем'
              : isSandbox
                ? `${minScore}–${maxScore}`
                : `${spent ?? 0} / ${budget} очков`
          }
        >
          Характеристики
        </SectionTitle>
        {abilitiesLocked && (state?.hero.pending_asi_points ?? 0) > 0 ? (
          <Typography sx={{ color: '#f0c24a', fontSize: '0.8rem', fontWeight: 800 }}>
            Доступно {state?.hero.pending_asi_points} очк. повышения — распределите их в окне
            «Повышение уровня».
          </Typography>
        ) : null}
        {overBudget ? (
          <Typography sx={{ color: '#e07a7a', fontSize: '0.8rem', fontWeight: 800 }}>
            Потрачено больше очков, чем доступно — уменьшите любую характеристику.
          </Typography>
        ) : null}
        <Stack spacing={0.6}>
          {DND_ABILITY_ORDER.map((abilityId) => {
            const baseScore = base[abilityId]
            const bonus = bonuses[abilityId] ?? 0
            const asi = Number((asiAllocation as Record<string, number>)[abilityId] ?? 0)
            const total = finalScores[abilityId]
            const cost = isSandbox ? null : pointBuyCost(catalog, baseScore)
            return (
              <Stack
                key={abilityId}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  px: 1,
                  py: 0.7,
                  borderRadius: '12px',
                  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 66%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
                }}
              >
                <Stack spacing={0} sx={{ width: { xs: 88, sm: 132 }, minWidth: 0 }}>
                  <Typography noWrap sx={{ color: 'var(--morius-title-text)', fontSize: '0.86rem', fontWeight: 900 }}>
                    {DND_ABILITY_LABELS[abilityId]}
                  </Typography>
                  {cost !== null ? (
                    <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.68rem', fontWeight: 700 }}>
                      стоимость {cost}
                    </Typography>
                  ) : null}
                </Stack>
                <Stack direction="row" alignItems="center" spacing={0.45}>
                  <StepperButton
                    label={`Уменьшить ${DND_ABILITY_LABELS[abilityId]}`}
                    disabled={saving || !canAfford(abilityId, baseScore - 1)}
                    onClick={() => setBase((previous) => ({ ...previous, [abilityId]: previous[abilityId] - 1 }))}
                  >
                    −
                  </StepperButton>
                  <Typography
                    sx={{
                      width: 34,
                      textAlign: 'center',
                      color: 'var(--morius-title-text)',
                      fontSize: '1rem',
                      fontWeight: 950,
                    }}
                  >
                    {baseScore}
                  </Typography>
                  <StepperButton
                    label={`Увеличить ${DND_ABILITY_LABELS[abilityId]}`}
                    disabled={saving || !canAfford(abilityId, baseScore + 1)}
                    onClick={() => setBase((previous) => ({ ...previous, [abilityId]: previous[abilityId] + 1 }))}
                  >
                    +
                  </StepperButton>
                </Stack>
                <Stack direction="row" spacing={0.4} alignItems="center" sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-end' }}>
                  {/* Sandbox edits the final number directly, so a "+2 racial" chip next to it
                      would be describing arithmetic that is not happening. */}
                  {!isSandbox && bonus ? (
                    <Tooltip disableInteractive title="Расовый бонус">
                      <Typography sx={{ color: '#5bb87a', fontSize: '0.76rem', fontWeight: 900 }}>+{bonus}</Typography>
                    </Tooltip>
                  ) : null}
                  {!isSandbox && asi ? (
                    <Tooltip disableInteractive title="Повышение за уровни">
                      <Typography sx={{ color: '#f0c24a', fontSize: '0.76rem', fontWeight: 900 }}>+{asi}</Typography>
                    </Tooltip>
                  ) : null}
                  <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.02rem', fontWeight: 950, minWidth: 28, textAlign: 'right' }}>
                    {total}
                  </Typography>
                  <Typography
                    sx={{
                      minWidth: 30,
                      textAlign: 'right',
                      color: abilityModifier(total) >= 0 ? '#5bb87a' : '#e0a93f',
                      fontSize: '0.8rem',
                      fontWeight: 900,
                    }}
                  >
                    {formatModifier(abilityModifier(total))}
                  </Typography>
                </Stack>
              </Stack>
            )
          })}
        </Stack>

        {/* --- Derived ---------------------------------------------------------------- */}
        <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            sx={{ px: 1, py: 0.6, borderRadius: '11px', backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)' }}
          >
            <DndHeartIcon size={16} sx={{ color: '#e05252' }} />
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.82rem', fontWeight: 900 }}>
              Хиты {Math.max(previewHp, 1)}
            </Typography>
          </Stack>
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            sx={{ px: 1, py: 0.6, borderRadius: '11px', backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)' }}
          >
            <DndShieldIcon size={16} sx={{ color: 'var(--morius-accent)' }} />
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.82rem', fontWeight: 900 }}>
              КД {isSandbox ? armorClass : state?.hero.armor_class ?? 10}
            </Typography>
          </Stack>
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            sx={{ px: 1, py: 0.6, borderRadius: '11px', backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)' }}
          >
            <DndStarIcon size={16} sx={{ color: '#f0c24a' }} />
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.82rem', fontWeight: 900 }}>
              Уровень {isSandbox ? level : state?.hero.level ?? 1}
            </Typography>
          </Stack>
        </Stack>

        {/* --- Skills ----------------------------------------------------------------- */}
        <SectionTitle hint={`${skills.length} / ${skillSlots}`}>Владение навыками</SectionTitle>
        {locks?.started && !isSandbox ? (
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.45 }}>
            {(locks?.free_skill_slots ?? 0) > 0
              ? `Свободных ячеек: ${locks?.free_skill_slots}. Выбранный навык остаётся с героем навсегда.`
              : `Все ячейки заняты. Новая откроется на ${locks?.next_skill_level || '—'} уровне.`}
          </Typography>
        ) : null}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {(catalog?.skills ?? []).map((skill) => {
            const isSelected = skills.includes(skill.id)
            const isClassSkill = classSkills.includes(skill.id)
            const isFrozen = lockedSkills.includes(skill.id)
            const isUnreachable = !isSelected && skills.length >= skillSlots
            return (
              <Chip
                key={skill.id}
                label={`${skill.label} · ${DND_ABILITY_SHORT[skill.ability]}`}
                icon={isFrozen ? <DndLockIcon size={13} sx={{ color: 'inherit !important', ml: 0.7 }} /> : undefined}
                onClick={() => toggleSkill(skill.id)}
                disabled={isUnreachable}
                sx={{
                  borderRadius: '999px',
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  height: 30,
                  cursor: isFrozen ? 'default' : 'pointer',
                  opacity: isUnreachable ? 0.45 : 1,
                  color: isSelected ? '#11070A' : 'var(--morius-text-secondary)',
                  backgroundColor: isSelected
                    ? 'var(--morius-accent)'
                    : 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
                  border: isClassSkill && !isSelected
                    ? 'var(--morius-border-width) dashed color-mix(in srgb, var(--morius-accent) 46%, transparent)'
                    : 'var(--morius-border-width) solid transparent',
                  '&:hover': {
                    backgroundColor: isSelected
                      ? 'var(--morius-accent)'
                      : 'color-mix(in srgb, var(--morius-accent) 18%, var(--morius-elevated-bg))',
                  },
                }}
              />
            )
          })}
        </Box>

        {/* --- Sandbox-only numbers ---------------------------------------------------- */}
        {isSandbox ? (
          <>
            <SectionTitle hint="только в песочнице">Ручные значения</SectionTitle>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                label="Уровень"
                type="number"
                value={level}
                onChange={(event) => setLevel(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
                fullWidth
                sx={fieldSx}
              />
              <TextField
                label="Хиты (макс.)"
                type="number"
                value={hpMax}
                onChange={(event) => setHpMax(Math.max(1, Math.min(9999, Number(event.target.value) || 1)))}
                fullWidth
                sx={fieldSx}
              />
              <TextField
                label="Хиты (сейчас)"
                type="number"
                value={hpCurrent}
                onChange={(event) => setHpCurrent(Math.max(0, Math.min(9999, Number(event.target.value) || 0)))}
                fullWidth
                sx={fieldSx}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                label="Класс доспеха"
                type="number"
                value={armorClass}
                onChange={(event) => setArmorClass(Math.max(1, Math.min(40, Number(event.target.value) || 10)))}
                fullWidth
                sx={fieldSx}
              />
              <TextField
                label="Скорость, футов"
                type="number"
                value={speed}
                onChange={(event) => setSpeed(Math.max(0, Math.min(200, Number(event.target.value) || 0)))}
                fullWidth
                sx={fieldSx}
              />
            </Stack>
          </>
        ) : null}

        {/* --- Starting money ----------------------------------------------------------- */}
        {/* Open while the character is still being built, in any mode. Wanting to start rich
            is a character concept, not a cheat, and it should not require sandbox. */}
        {setupOpen ? (
          <>
            <SectionTitle hint={currencyLabel}>Стартовые деньги</SectionTitle>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 0.3 }}>
              {wealthPresets.map((preset) => (
                <Chip
                  key={preset.id}
                  label={preset.label}
                  onClick={() => setPurse(preset.amount)}
                  sx={{
                    borderRadius: '999px',
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    height: 28,
                    color: purse === preset.amount ? '#11070A' : 'var(--morius-text-secondary)',
                    backgroundColor:
                      purse === preset.amount
                        ? '#e0c05a'
                        : 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
                    '&:hover': {
                      backgroundColor: purse === preset.amount ? '#e0c05a' : 'rgba(224, 192, 90, 0.18)',
                    },
                  }}
                />
              ))}
            </Stack>
            <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
              {purseDenominations.map((denomination) => (
                <TextField
                  key={denomination.id}
                  label={denomination.label}
                  type="number"
                  size="small"
                  value={coinCounts[denomination.id] ?? 0}
                  onChange={(event) => handleCoinChange(denomination.id, event.target.value)}
                  sx={{ ...fieldSx, width: 116 }}
                />
              ))}
              <Stack justifyContent="center" sx={{ pl: 0.4 }}>
                <Typography sx={{ color: '#e0c05a', fontSize: '0.86rem', fontWeight: 950 }}>
                  {purseDisplay}
                </Typography>
              </Stack>
            </Stack>
          </>
        ) : null}

        {/* --- Inventory --------------------------------------------------------------- */}
        <SectionTitle hint={setupOpen ? 'через запятую' : 'ведёт мастер'}>Инвентарь</SectionTitle>
        {setupOpen ? (
          <TextField
            value={inventoryText}
            onChange={(event) => setInventoryText(event.target.value)}
            fullWidth
            multiline
            minRows={2}
            maxRows={6}
            placeholder="Короткий меч, кожаный доспех, тёмно-красная роба, скрытые клинки на предплечьях"
            helperText="Допишите сюда всё, что у героя есть по предыстории — своя одежда, памятная вещь, необычное оружие"
            sx={fieldSx}
          />
        ) : (
          <Typography
            sx={{
              px: 1.1,
              py: 0.9,
              borderRadius: '12px',
              backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
              color: 'var(--morius-text-primary)',
              fontSize: '0.84rem',
              lineHeight: 1.5,
            }}
          >
            {previewInventory.length
              ? previewInventory.join(', ')
              : `Стартовый набор класса «${labelForClass(catalog, classId)}» выдаётся автоматически.`}
            {inventoryIsPreview ? (
              <Box
                component="span"
                sx={{ display: 'block', mt: 0.5, color: 'var(--morius-text-secondary)', fontSize: '0.76rem', fontWeight: 800 }}
              >
                Набор класса «{labelForClass(catalog, classId)}» — применится при сохранении.
              </Box>
            ) : null}
          </Typography>
        )}
        <TextField
          label="Заметка о снаряжении"
          value={inventoryNote}
          onChange={(event) => setInventoryNote(event.target.value)}
          fullWidth
          multiline
          minRows={1}
          maxRows={4}
          inputProps={{ maxLength: 2000 }}
          sx={fieldSx}
        />

        {/* --- Avatar ------------------------------------------------------------------ */}
        {mainHeroCards.length ? (
          <>
            <SectionTitle hint="из карточек главного героя">Аватар</SectionTitle>
            <Stack direction="row" spacing={0.75} sx={{ overflowX: 'auto', pb: 0.5 }}>
              {mainHeroCards.map((card) => {
                const isSelected = avatarCardId === card.id
                const avatar = resolveCardAvatar(card)
                return (
                  <Tooltip key={card.id} disableInteractive title={card.title}>
                    <Box
                      role="button"
                      tabIndex={0}
                      onClick={() => setAvatarCardId(isSelected ? null : card.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setAvatarCardId(isSelected ? null : card.id)
                        }
                      }}
                      sx={{
                        width: 58,
                        height: 58,
                        flexShrink: 0,
                        borderRadius: '13px',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        outline: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: isSelected
                          ? '2px solid var(--morius-accent)'
                          : 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 70%, transparent)',
                        backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
                      }}
                    >
                      {avatar ? (
                        <Box component="img" src={avatar} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <Typography sx={{ color: 'var(--morius-accent)', fontSize: '1.3rem', fontWeight: 950 }}>
                          {card.title.trim().charAt(0).toUpperCase()}
                        </Typography>
                      )}
                    </Box>
                  </Tooltip>
                )
              })}
            </Stack>
          </>
        ) : null}
      </Stack>
    </BaseDialog>
  )
}
