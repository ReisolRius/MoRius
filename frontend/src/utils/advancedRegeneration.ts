import type { SmartRegenerationMode, SmartRegenerationOption } from '../types/story'

export const DEFAULT_SMART_REGENERATION_MODE: SmartRegenerationMode = 'new_variant'

export type SmartRegenerationModeDefinition = {
  id: SmartRegenerationMode
  label: string
  description: string
}

export const SMART_REGENERATION_MODE_DEFINITIONS: SmartRegenerationModeDefinition[] = [
  {
    id: 'new_variant',
    label: 'Новый вариант',
    description: 'Сгенерировать другой ответ на последний ход, не копируя предыдущий.',
  },
  {
    id: 'improve_existing',
    label: 'Улучшить текущий',
    description: 'Сохранить суть ответа, но исправить и усилить выбранные аспекты.',
  },
]

export function normalizeSmartRegenerationMode(mode: SmartRegenerationMode | null | undefined): SmartRegenerationMode {
  return mode === 'improve_existing' ? 'improve_existing' : DEFAULT_SMART_REGENERATION_MODE
}

export type SmartRegenerationOptionDefinition = {
  id: SmartRegenerationOption
  label: string
  description: string
  disabled?: boolean
}

export const SMART_REGENERATION_OPTION_DEFINITIONS: SmartRegenerationOptionDefinition[] = [
  {
    id: 'fix_language',
    label: 'Исправить язык',
    description: 'Убрать английские вставки, странные слова, машинные обороты и ошибки русского.',
  },
  {
    id: 'make_more_alive',
    label: 'Сделать живее',
    description: 'Добавить естественных эмоций, реакций, жестов и менее сухую подачу.',
  },
  {
    id: 'make_shorter',
    label: 'Сделать короче',
    description: 'Сжать ответ, убрать воду и оставить главное.',
  },
  {
    id: 'make_more_detailed',
    label: 'Сделать подробнее',
    description: 'Добавить деталей, атмосферы и плавности, не меняя факты.',
  },
  {
    id: 'more_action',
    label: 'Больше действия',
    description: 'Сместить ответ к событиям, движениям и последствиям.',
  },
  {
    id: 'more_dialogue',
    label: 'Больше диалога',
    description: 'Сместить ответ к репликам персонажей и живому обмену фразами.',
  },
  {
    id: 'less_pathos',
    label: 'Меньше пафоса',
    description: 'Сделать стиль проще, естественнее, без чрезмерной драматичности.',
  },
  {
    id: 'stricter_facts',
    label: 'Строже по фактам',
    description: 'Сильнее соблюдать память, состояние сцены, предметы, позиции и адресатов.',
  },
  {
    id: 'remove_repetition',
    label: 'Убрать повтор',
    description: 'Избавиться от повторяющихся фраз, жестов и шаблонной структуры.',
  },
  {
    id: 'preserve_format',
    label: 'Сохранить формат реплик',
    description: 'Дополнительно проверить, что блоки персонажей, имена и аватарки не сломаются.',
    disabled: true,
  },
]

export const conflictingOptions: Partial<Record<SmartRegenerationOption, SmartRegenerationOption[]>> = {
  make_shorter: ['make_more_detailed'],
  make_more_detailed: ['make_shorter'],
}

export function normalizeSmartRegenerationOptions(options: SmartRegenerationOption[]): SmartRegenerationOption[] {
  const seenOptions = new Set<SmartRegenerationOption>()
  const normalizedOptions: SmartRegenerationOption[] = []
  for (const option of options) {
    if (seenOptions.has(option)) {
      continue
    }
    seenOptions.add(option)
    normalizedOptions.push(option)
  }
  return normalizedOptions
}

export function resolveSmartRegenerationOptionSelection(
  currentOptions: SmartRegenerationOption[],
  option: SmartRegenerationOption,
): SmartRegenerationOption[] {
  if (option === 'preserve_format') {
    return normalizeSmartRegenerationOptions([...currentOptions, option])
  }

  const optionSet = new Set(currentOptions)
  if (optionSet.has(option)) {
    optionSet.delete(option)
    return normalizeSmartRegenerationOptions([...optionSet])
  }

  for (const conflict of conflictingOptions[option] ?? []) {
    optionSet.delete(conflict)
  }
  optionSet.add(option)
  return normalizeSmartRegenerationOptions([...optionSet])
}
