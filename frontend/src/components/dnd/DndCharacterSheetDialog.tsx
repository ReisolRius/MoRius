// The character sheet editor.
//
// Two shapes behind one dialog. In "режим игры" the ability scores run through the 5e
// 27-point buy: the steppers refuse to leave 8..15, the budget counter shows what is left,
// and the racial bonus is previewed rather than typed — which is what stops a level 1 hero
// from having an 18 in anything. In "режим песочницы" the same controls open up to 1..30
// with a free level, hit points, armour class and inventory.
//
// The server validates all of it again on save, so the rules here are for the player's
// benefit, not for safety.

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
  resolveCardAvatar: (card: StoryWorldCard) => string | null
  saving: boolean
  error: string
  onClose: () => void
  onSave: (hero: StoryDndHeroInput) => void
  onChangePlayMode: (playMode: 'game' | 'sandbox') => void
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
  resolveCardAvatar,
  saving,
  error,
  onClose,
  onSave,
  onChangePlayMode,
  onReset,
}: DndCharacterSheetDialogProps) {
  const isSandbox = state?.play_mode === 'sandbox'
  const [name, setName] = useState('')
  const [raceId, setRaceId] = useState('human')
  const [classId, setClassId] = useState('fighter')
  const [background, setBackground] = useState('')
  const [base, setBase] = useState<Record<DndAbilityId, number>>(DEFAULT_BASE)
  const [skills, setSkills] = useState<string[]>([])
  const [level, setLevel] = useState(1)
  const [hpMax, setHpMax] = useState(10)
  const [hpCurrent, setHpCurrent] = useState(10)
  const [armorClass, setArmorClass] = useState(10)
  const [speed, setSpeed] = useState(30)
  const [gold, setGold] = useState(0)
  const [inventoryText, setInventoryText] = useState('')
  const [inventoryNote, setInventoryNote] = useState('')
  const [avatarCardId, setAvatarCardId] = useState<number | null>(null)

  // Re-seed the form when the dialog opens, and again when the play mode changes -- switching
  // to sandbox rewrites the ability basis server-side, so the form has to follow. Deliberately
  // NOT on every state change: a post-turn push would otherwise wipe what the player is typing.
  const seedKey = `${open ? 'open' : 'closed'}:${state?.play_mode ?? 'game'}`
  useEffect(() => {
    if (!open || !state) {
      return
    }
    const hero = state.hero
    setName(hero.name)
    setRaceId(hero.race)
    setClassId(hero.class)
    setBackground(hero.background)
    setBase({ ...DEFAULT_BASE, ...hero.base_abilities })
    setSkills(hero.skill_proficiencies)
    setLevel(hero.level)
    setHpMax(hero.hp.max)
    setHpCurrent(hero.hp.current)
    setArmorClass(hero.armor_class)
    setSpeed(hero.speed)
    setGold(hero.gold)
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

  const toggleSkill = (skillId: string) => {
    setSkills((previous) => {
      if (previous.includes(skillId)) {
        return previous.filter((item) => item !== skillId)
      }
      if (previous.length >= 6) {
        return previous
      }
      return [...previous, skillId]
    })
  }

  const handleSave = () => {
    const hero: StoryDndHeroInput = {
      name,
      race: raceId,
      class: classId,
      background,
      base_abilities: base,
      skill_proficiencies: skills,
      gold,
      inventory_note: inventoryNote,
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
      hero.inventory = inventoryText
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }
    onSave(hero)
  }

  const derivedHitDie = catalog?.classes.find((item) => item.id === classId)?.hit_die ?? 10
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
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--morius-accent) 92%, #fff 8%), var(--morius-accent)) !important',
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
        {/* --- Play mode ------------------------------------------------------------- */}
        <Stack
          direction="row"
          spacing={0.6}
          sx={{
            p: 0.4,
            borderRadius: '14px',
            backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 88%, transparent)',
          }}
        >
          {(['game', 'sandbox'] as const).map((mode) => {
            const isActive = (state?.play_mode ?? 'game') === mode
            return (
              <DndSurfaceButton
                key={mode}
                active={isActive}
                onClick={() => onChangePlayMode(mode)}
                disabled={saving}
                sx={{
                  flex: 1,
                  minHeight: 40,
                  borderRadius: '11px',
                  fontSize: '0.86rem',
                  fontWeight: 900,
                  borderColor: isActive ? 'var(--morius-accent)' : 'transparent',
                  backgroundColor: isActive ? 'var(--morius-accent)' : 'transparent',
                }}
              >
                {mode === 'game' ? 'Режим игры' : 'Режим песочницы'}
              </DndSurfaceButton>
            )
          })}
        </Stack>
        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.45 }}>
          {isSandbox
            ? 'Песочница: характеристики от 1 до 30, свободный уровень, хиты и инвентарь. Опыт копится, но уровень вы задаёте сами. Время и погоду можно менять в любой момент.'
            : `Режим игры: характеристики по закупке очков D&D 5e (${budget} очков, базовое значение ${minScore}–${maxScore}), расовый бонус сверху. Выше 20 не поднимется никогда, на 1 уровне — не выше 17.`}
        </Typography>

        {error ? (
          <Typography sx={{ color: '#e07a7a', fontSize: '0.82rem', fontWeight: 800 }}>{error}</Typography>
        ) : null}

        {/* --- Identity -------------------------------------------------------------- */}
        <SectionTitle>Кто вы</SectionTitle>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            label="Имя героя"
            value={name}
            onChange={(event) => setName(event.target.value)}
            fullWidth
            inputProps={{ maxLength: 80 }}
            sx={fieldSx}
          />
          <TextField
            label="Предыстория"
            value={background}
            onChange={(event) => setBackground(event.target.value)}
            fullWidth
            inputProps={{ maxLength: 80 }}
            sx={fieldSx}
          />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            select
            label="Раса"
            value={raceId}
            onChange={(event) => setRaceId(event.target.value)}
            fullWidth
            sx={fieldSx}
            helperText={
              Object.entries(bonuses).length
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
              setSkills(nextSkills.slice(0, 6))
            }}
            fullWidth
            sx={fieldSx}
            helperText={`Кость хитов d${derivedHitDie}`}
          >
            {(catalog?.classes ?? []).map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {item.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {/* --- Abilities -------------------------------------------------------------- */}
        <SectionTitle hint={isSandbox ? `${minScore}–${maxScore}` : `${spent ?? 0} / ${budget} очков`}>
          Характеристики
        </SectionTitle>
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
        <SectionTitle hint={`${skills.length} / 6`}>Владение навыками</SectionTitle>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {(catalog?.skills ?? []).map((skill) => {
            const isSelected = skills.includes(skill.id)
            const isClassSkill = classSkills.includes(skill.id)
            return (
              <Chip
                key={skill.id}
                label={`${skill.label} · ${DND_ABILITY_SHORT[skill.ability]}`}
                onClick={() => toggleSkill(skill.id)}
                sx={{
                  borderRadius: '999px',
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  height: 30,
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
              <TextField
                label="Золото"
                type="number"
                value={gold}
                onChange={(event) => setGold(Math.max(0, Number(event.target.value) || 0))}
                fullWidth
                sx={fieldSx}
              />
            </Stack>
          </>
        ) : null}

        {/* --- Inventory --------------------------------------------------------------- */}
        <SectionTitle hint={isSandbox ? 'через запятую' : 'ведёт мастер'}>Инвентарь</SectionTitle>
        {isSandbox ? (
          <TextField
            value={inventoryText}
            onChange={(event) => setInventoryText(event.target.value)}
            fullWidth
            multiline
            minRows={2}
            maxRows={6}
            placeholder="Меч, зелье лечения, верёвка 15 метров"
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
            {state?.hero.inventory.length
              ? state.hero.inventory.join(', ')
              : `Стартовый набор класса «${labelForClass(catalog, classId)}» выдаётся автоматически.`}
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
