// Display helpers shared by every D&D panel: labels, palettes and the small bits of maths
// the UI shows next to a number. The rules themselves live on the server — nothing here
// decides an outcome, it only renders one.

import type {
  DndAbilityId,
  DndCatalog,
  DndOutcome,
  DndState,
} from '../../types/story'

export const DND_ABILITY_ORDER: DndAbilityId[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

export const DND_ABILITY_LABELS: Record<DndAbilityId, string> = {
  str: 'Сила',
  dex: 'Ловкость',
  con: 'Телосложение',
  int: 'Интеллект',
  wis: 'Мудрость',
  cha: 'Харизма',
}

export const DND_ABILITY_SHORT: Record<DndAbilityId, string> = {
  str: 'СИЛ',
  dex: 'ЛОВ',
  con: 'ТЕЛ',
  int: 'ИНТ',
  wis: 'МДР',
  cha: 'ХАР',
}

// Which four read as "the basics" on a collapsed sheet. Chosen for what a player glances at
// mid-scene rather than for rules significance.
export const DND_PRIMARY_ABILITIES: DndAbilityId[] = ['str', 'dex', 'con', 'cha']

export function abilityModifier(score: number | undefined | null): number {
  const normalized = Number.isFinite(Number(score)) ? Number(score) : 10
  return Math.floor((normalized - 10) / 2)
}

export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : String(value)
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// --- Weather and time -----------------------------------------------------------------------

export const DND_TIME_LABELS: Record<string, string> = {
  dawn: 'Рассвет',
  morning: 'Утро',
  noon: 'Полдень',
  afternoon: 'День',
  evening: 'Вечер',
  dusk: 'Сумерки',
  night: 'Ночь',
  midnight: 'Глубокая ночь',
}

export const DND_WEATHER_LABELS: Record<string, string> = {
  clear: 'Ясно',
  sunny: 'Солнечно',
  cloudy: 'Облачно',
  overcast: 'Пасмурно',
  fog: 'Туман',
  rain: 'Дождь',
  storm: 'Гроза',
  snow: 'Снег',
  blizzard: 'Метель',
  wind: 'Ветрено',
  heat: 'Зной',
}

export const DND_SEASON_LABELS: Record<string, string> = {
  spring: 'Весна',
  summer: 'Лето',
  autumn: 'Осень',
  winter: 'Зима',
}

export const DND_RELATION_LABELS: Record<string, string> = {
  hostile: 'Враждебное',
  hateful: 'Ненависть',
  wary: 'Настороженное',
  neutral: 'Нейтральное',
  friendly: 'Дружеское',
  loyal: 'Преданное',
  devoted: 'Обожание',
  in_love: 'Влюблена',
}

// Noun labels so they sit correctly after any character's name.
export const DND_MOOD_LABELS: Record<string, string> = {
  furious: 'Ярость',
  angry: 'Злость',
  hurt: 'Обида',
  wary_mood: 'Настороженность',
  calm: 'Спокойствие',
  amused: 'Хорошее расположение',
  warm: 'Теплота',
  grateful: 'Благодарность',
}

export function moodColor(mood: string): string {
  switch (mood) {
    case 'furious':
    case 'angry':
      return '#e05252'
    case 'hurt':
    case 'wary_mood':
      return '#e0a93f'
    case 'warm':
    case 'grateful':
    case 'amused':
      return '#5bb87a'
    default:
      return 'var(--morius-text-secondary)'
  }
}

export const DND_OUTCOME_LABELS: Record<DndOutcome, string> = {
  critical_success: 'Критический успех',
  success: 'Успех',
  failure: 'Провал',
  critical_failure: 'Критический провал',
}

// Sky gradients per time of day. These drive the weather tab's backdrop, which is the one
// place in the left menu where a glance should tell you the hour without reading a word.
const DND_TIME_GRADIENTS: Record<string, [string, string]> = {
  dawn: ['#2b2340', '#c2765a'],
  morning: ['#2a4a73', '#7fb3e0'],
  noon: ['#2f6fb0', '#9fd0f5'],
  afternoon: ['#2e628f', '#8fc0e8'],
  evening: ['#3a3054', '#d08a5c'],
  dusk: ['#24203c', '#7a5b86'],
  night: ['#101527', '#2b3557'],
  midnight: ['#080b16', '#1b2136'],
}

// How much the weather dims and tints the sky above.
const DND_WEATHER_OVERLAYS: Record<string, string> = {
  clear: 'transparent',
  sunny: 'rgba(255, 214, 120, 0.16)',
  cloudy: 'rgba(160, 170, 190, 0.22)',
  overcast: 'rgba(120, 128, 145, 0.38)',
  fog: 'rgba(198, 205, 215, 0.34)',
  rain: 'rgba(70, 92, 120, 0.42)',
  storm: 'rgba(30, 38, 58, 0.54)',
  snow: 'rgba(214, 228, 245, 0.3)',
  blizzard: 'rgba(190, 210, 235, 0.44)',
  wind: 'rgba(150, 175, 190, 0.2)',
  heat: 'rgba(255, 160, 80, 0.26)',
}

export function timeGradient(timeOfDay: string): [string, string] {
  return DND_TIME_GRADIENTS[timeOfDay] ?? DND_TIME_GRADIENTS.morning
}

export function weatherOverlay(weather: string): string {
  return DND_WEATHER_OVERLAYS[weather] ?? 'transparent'
}

export function isDarkTimeOfDay(timeOfDay: string): boolean {
  return timeOfDay === 'night' || timeOfDay === 'midnight' || timeOfDay === 'dusk'
}

// --- Health -------------------------------------------------------------------------------

export function healthRatio(current: number, max: number): number {
  const normalizedMax = Math.max(Number(max) || 1, 1)
  return clampNumber((Number(current) || 0) / normalizedMax, 0, 1)
}

// Red below a quarter, amber below a half, green above. The thresholds match the moments a
// 5e table actually reacts to: "bloodied" at half and "one hit from down" near the bottom.
export function healthColor(ratio: number): string {
  if (ratio <= 0.25) {
    return '#e05252'
  }
  if (ratio <= 0.5) {
    return '#e0a93f'
  }
  return '#5bb87a'
}

export function relationColor(relation: string): string {
  switch (relation) {
    case 'hostile':
    case 'hateful':
      return '#e05252'
    case 'wary':
      return '#e0a93f'
    case 'friendly':
      return '#5bb87a'
    case 'loyal':
    case 'devoted':
      return '#4c8dff'
    case 'in_love':
      return '#e06aa8'
    default:
      return 'var(--morius-text-secondary)'
  }
}

export function outcomeColor(outcome: DndOutcome): string {
  switch (outcome) {
    case 'critical_success':
      return '#f0c24a'
    case 'success':
      return '#5bb87a'
    case 'critical_failure':
      return '#e05252'
    default:
      return '#c9744a'
  }
}

// --- Experience ---------------------------------------------------------------------------

export type DndXpProgress = {
  level: number
  currentXp: number
  levelFloor: number
  nextThreshold: number | null
  gainedInLevel: number
  neededInLevel: number
  ratio: number
  isMaxLevel: boolean
}

export function xpProgress(state: DndState, catalog: DndCatalog | null): DndXpProgress {
  const thresholds = catalog?.xp_thresholds ?? []
  const level = Math.max(1, Number(state.hero?.level) || 1)
  const currentXp = Math.max(0, Number(state.hero?.xp) || 0)
  const levelFloor = thresholds[level - 1] ?? 0
  const nextThreshold = level >= (catalog?.max_level ?? 20) ? null : thresholds[level] ?? null
  if (nextThreshold === null) {
    return {
      level,
      currentXp,
      levelFloor,
      nextThreshold: null,
      gainedInLevel: currentXp - levelFloor,
      neededInLevel: 0,
      ratio: 1,
      isMaxLevel: true,
    }
  }
  const neededInLevel = Math.max(1, nextThreshold - levelFloor)
  const gainedInLevel = clampNumber(currentXp - levelFloor, 0, neededInLevel)
  return {
    level,
    currentXp,
    levelFloor,
    nextThreshold,
    gainedInLevel,
    neededInLevel,
    ratio: gainedInLevel / neededInLevel,
    isMaxLevel: false,
  }
}

// --- Point buy ------------------------------------------------------------------------------

export function pointBuyCost(catalog: DndCatalog | null, score: number): number | null {
  const table = catalog?.point_buy?.cost
  if (!table) {
    return null
  }
  const cost = table[String(score)]
  return typeof cost === 'number' ? cost : null
}

export function pointBuySpent(catalog: DndCatalog | null, scores: Record<string, number>): number | null {
  let total = 0
  for (const abilityId of DND_ABILITY_ORDER) {
    const cost = pointBuyCost(catalog, Number(scores[abilityId]))
    if (cost === null) {
      return null
    }
    total += cost
  }
  return total
}

export function raceBonuses(catalog: DndCatalog | null, raceId: string): Partial<Record<DndAbilityId, number>> {
  return catalog?.races.find((race) => race.id === raceId)?.bonuses ?? {}
}

export function labelForRace(catalog: DndCatalog | null, raceId: string): string {
  return catalog?.races.find((race) => race.id === raceId)?.label ?? raceId
}

export function labelForClass(catalog: DndCatalog | null, classId: string): string {
  return catalog?.classes.find((item) => item.id === classId)?.label ?? classId
}

export function labelForSkill(catalog: DndCatalog | null, skillId: string): string {
  return catalog?.skills.find((item) => item.id === skillId)?.label ?? skillId
}

export function describeCheckSubject(
  catalog: DndCatalog | null,
  check: { kind?: string; skill?: string; ability?: string } | null | undefined,
): string {
  if (!check) {
    return 'Проверка'
  }
  if (check.skill) {
    return labelForSkill(catalog, check.skill)
  }
  if (check.kind === 'death_save') {
    return 'Жизнь героя'
  }
  if (check.ability) {
    return DND_ABILITY_LABELS[check.ability as DndAbilityId] ?? check.ability
  }
  return 'Проверка'
}

export function describeCheckKind(kind: string | undefined): string {
  switch (kind) {
    case 'saving_throw':
      return 'Спасбросок'
    case 'attack':
      return 'Бросок атаки'
    case 'ability':
      return 'Проверка характеристики'
    case 'death_save':
      return 'Спасбросок от смерти'
    case 'initiative':
      return 'Инициатива'
    default:
      return 'Проверка навыка'
  }
}

export const DND_LIFE_STATE_LABELS: Record<string, string> = {
  alive: 'В сознании',
  dying: 'При смерти',
  stable: 'Без сознания, стабилен',
  dead: 'Мёртв',
}

export function difficultyLabel(catalog: DndCatalog | null, dc: number): string {
  const entries = catalog?.dc_labels ?? []
  let label = ''
  for (const entry of entries) {
    if (dc >= entry.value) {
      label = entry.label
    }
  }
  return label
}
