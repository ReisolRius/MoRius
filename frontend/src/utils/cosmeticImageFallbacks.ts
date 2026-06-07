import type { CosmeticItem, CosmeticItemKind } from '../services/authApi'
import sakuraFrameImageUrl from '../assets/cosmetics/frame-sakura.png'
import sakuraProfileBannerImageUrl from '../assets/cosmetics/profile-banner-sakura-castle.png'

export const SYSTEM_AVATAR_FRAME_SAKURA_IMAGE_URL = sakuraFrameImageUrl
export const SYSTEM_PROFILE_BANNER_SAKURA_IMAGE_URL = sakuraProfileBannerImageUrl

function normalizeCosmeticSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function hasSakuraFrameSignature(value: string): boolean {
  const text = normalizeCosmeticSearchText(value)
  return (
    text.includes('\u0441\u0430\u043a\u0443\u0440') ||
    text.includes('sakura') ||
    text.includes('frame-sakura') ||
    text.includes('avatar-frames')
  )
}

function hasSakuraBannerSignature(value: string): boolean {
  const text = normalizeCosmeticSearchText(value)
  return (
    text.includes('\u0441\u0430\u043a\u0443\u0440') ||
    text.includes('sakura') ||
    text.includes('profile-banner-sakura') ||
    text.includes('sakura-castle')
  )
}

export function resolveKnownCosmeticImageUrl(payload: {
  kind: CosmeticItemKind
  selectionId?: string | null
  title?: string | null
  description?: string | null
  imageUrl?: string | null
}): string | null {
  const imageUrl = typeof payload.imageUrl === 'string' && payload.imageUrl.trim() ? payload.imageUrl.trim() : null
  const searchText = `${payload.selectionId ?? ''} ${payload.title ?? ''} ${payload.description ?? ''} ${imageUrl ?? ''}`
  if (payload.kind === 'avatar_frame' && (payload.selectionId === 'f1' || hasSakuraFrameSignature(searchText))) {
    return SYSTEM_AVATAR_FRAME_SAKURA_IMAGE_URL
  }
  if (payload.kind === 'profile_banner' && (payload.selectionId === 'b2' || hasSakuraBannerSignature(searchText))) {
    return SYSTEM_PROFILE_BANNER_SAKURA_IMAGE_URL
  }
  return imageUrl
}

export function withKnownCosmeticImageUrl(item: CosmeticItem): CosmeticItem {
  const imageUrl = resolveKnownCosmeticImageUrl({
    kind: item.kind,
    selectionId: item.selection_id,
    title: item.title,
    description: item.description,
    imageUrl: item.image_url,
  })
  return imageUrl && imageUrl !== item.image_url ? { ...item, image_url: imageUrl } : item
}

export function resolveAvatarFrameImageUrl(frameId?: string | null, frameImageUrl?: string | null): string | null {
  return resolveKnownCosmeticImageUrl({
    kind: 'avatar_frame',
    selectionId: frameId,
    imageUrl: frameImageUrl,
  })
}

export function resolveProfileBannerImageUrl(bannerId?: string | null, bannerImageUrl?: string | null): string | null {
  return resolveKnownCosmeticImageUrl({
    kind: 'profile_banner',
    selectionId: bannerId,
    imageUrl: bannerImageUrl,
  })
}
