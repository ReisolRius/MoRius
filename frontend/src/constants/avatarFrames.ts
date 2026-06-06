export const DEFAULT_AVATAR_FRAME_ID = 'none'
export const AVATAR_FRAME_IDS = ['none', 'p2', 'p3', 'p4', 'p5'] as const

export type AvatarFramePreset = {
  id: string
  label: string
  imageSrc: string | null
  ring?: {
    border: string
    shadow: string
  }
}

export const AVATAR_FRAME_PRESETS: AvatarFramePreset[] = [
  { id: 'none', label: 'Без рамки', imageSrc: null },
  {
    id: 'p2',
    label: 'Серебро',
    imageSrc: null,
    ring: {
      border: '2px solid rgba(218, 228, 242, 0.78)',
      shadow: '0 0 0 1px rgba(255,255,255,0.18), 0 0 18px rgba(190,210,235,0.22)',
    },
  },
  {
    id: 'p3',
    label: 'Янтарь',
    imageSrc: null,
    ring: {
      border: '2px solid rgba(240, 177, 88, 0.86)',
      shadow: '0 0 0 1px rgba(255,220,154,0.18), 0 0 18px rgba(240,177,88,0.26)',
    },
  },
  {
    id: 'p4',
    label: 'Изумруд',
    imageSrc: null,
    ring: {
      border: '2px solid rgba(98, 210, 164, 0.82)',
      shadow: '0 0 0 1px rgba(169,255,219,0.16), 0 0 18px rgba(98,210,164,0.24)',
    },
  },
  {
    id: 'p5',
    label: 'Ночь',
    imageSrc: null,
    ring: {
      border: '2px solid rgba(137, 155, 255, 0.82)',
      shadow: '0 0 0 1px rgba(202,211,255,0.16), 0 0 18px rgba(137,155,255,0.24)',
    },
  },
]

export function normalizeAvatarFrameId(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_AVATAR_FRAME_ID
  }
  const normalized = value.trim()
  return AVATAR_FRAME_IDS.includes(normalized as (typeof AVATAR_FRAME_IDS)[number]) || /^f[1-9]\d*$/.test(normalized)
    ? normalized
    : DEFAULT_AVATAR_FRAME_ID
}

export function getAvatarFramePreset(value: unknown): AvatarFramePreset {
  const normalized = normalizeAvatarFrameId(value)
  return AVATAR_FRAME_PRESETS.find((preset) => preset.id === normalized) ?? AVATAR_FRAME_PRESETS[0]
}
