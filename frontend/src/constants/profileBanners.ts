import profileBanner1 from '../assets/images/profile-banners/profile-banner-1.webp'
import profileBanner2 from '../assets/images/profile-banners/profile-banner-2.webp'
import profileBanner3 from '../assets/images/profile-banners/profile-banner-3.webp'
import profileBanner4 from '../assets/images/profile-banners/profile-banner-4.webp'
import profileBanner5 from '../assets/images/profile-banners/profile-banner-5.webp'

export const DEFAULT_PROFILE_BANNER_ID = '2'
export const PROFILE_BANNER_IDS = ['1', '2', '3', '4', '5'] as const

export type ProfileBannerId = typeof PROFILE_BANNER_IDS[number]

export type ProfileBannerPreset = {
  id: ProfileBannerId
  label: string
  src: string
  objectPosition: string
}

export const PROFILE_BANNER_PRESETS: ProfileBannerPreset[] = [
  { id: '1', label: 'Вариант 1', src: profileBanner1, objectPosition: 'center center' },
  { id: '2', label: 'Вариант 2', src: profileBanner2, objectPosition: 'center center' },
  { id: '3', label: 'Вариант 3', src: profileBanner3, objectPosition: 'center center' },
  { id: '4', label: 'Вариант 4', src: profileBanner4, objectPosition: 'center center' },
  { id: '5', label: 'Вариант 5', src: profileBanner5, objectPosition: 'center center' },
]

export function normalizeProfileBannerId(value: unknown): ProfileBannerId {
  return PROFILE_BANNER_IDS.includes(value as ProfileBannerId) ? (value as ProfileBannerId) : DEFAULT_PROFILE_BANNER_ID
}

export function getProfileBannerPreset(value: unknown): ProfileBannerPreset {
  const normalizedId = normalizeProfileBannerId(value)
  return PROFILE_BANNER_PRESETS.find((preset) => preset.id === normalizedId) ?? PROFILE_BANNER_PRESETS[1]
}
