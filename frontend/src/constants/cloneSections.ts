/**
 * What a world clone can carry over. Shared by every clone dialog (My Games, Profile) and by
 * the picker that renders them, so the list and its defaults exist in exactly one place.
 *
 * Hints are kept short on purpose: the picker draws each tile as one line of `noWrap` text at
 * the narrowest phone width, so anything past ~16 characters ellipsises there.
 */

export type CloneSectionKey = 'instructions' | 'plot' | 'world' | 'main_hero' | 'history' | 'nodes'
export type CloneSelectionState = Record<CloneSectionKey, boolean>

export const CLONE_SECTION_ITEMS: Array<{ key: CloneSectionKey; label: string; hint: string }> = [
  { key: 'instructions', label: 'Инструкции', hint: 'Карточки правил' },
  { key: 'plot', label: 'Сюжет', hint: 'Карточки сюжета' },
  { key: 'world', label: 'Мир', hint: 'Мир и NPC' },
  { key: 'main_hero', label: 'ГГ', hint: 'Главный герой' },
  { key: 'history', label: 'История', hint: 'Ходы и память' },
  { key: 'nodes', label: 'Ноды', hint: 'Схема связей' },
]

export const CLONE_SECTION_DEFAULTS: CloneSelectionState = {
  instructions: true,
  plot: true,
  world: true,
  main_hero: true,
  history: true,
  nodes: true,
}
