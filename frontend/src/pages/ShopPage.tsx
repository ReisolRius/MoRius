import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import AppHeader from '../components/AppHeader'
import HeaderAccountActions from '../components/HeaderAccountActions'
import SoulAmount from '../components/currency/SoulAmount'
import ProgressiveImage from '../components/media/ProgressiveImage'
import UserAvatar from '../components/profile/UserAvatar'
import AvatarFrame from '../components/profile/AvatarFrame'
import {
  createCoinTopUpPayment,
  deleteShopCosmeticItem,
  createShopCosmeticItem,
  getShopCatalog,
  purchaseShopCosmeticItem,
  updateShopCosmeticItem,
  type CoinTopUpPlan,
  type CosmeticItem,
  type CosmeticItemKind,
  type ShopCatalog,
} from '../services/authApi'
import type { AuthUser } from '../types/auth'
import { moriusThemeTokens } from '../theme'
import { withKnownCosmeticImageUrl } from '../utils/cosmeticImageFallbacks'

type ShopPageProps = {
  user: AuthUser
  authToken: string
  onNavigate: (path: string) => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
}

type PreviewTarget = { kind: CosmeticItemKind; item: CosmeticItem }

const HEADER_AVATAR_SIZE = moriusThemeTokens.layout.headerButtonSize
const SHOP_DIALOG_PAPER_SX = {
  borderRadius: '18px',
  border: 'var(--morius-border-width) solid var(--morius-card-border)',
  backgroundColor: '#11161d',
  color: 'var(--morius-text-primary)',
  boxShadow: '0 28px 70px rgba(0,0,0,0.72)',
  '& .MuiDialogTitle-root': {
    color: 'var(--morius-title-text)',
  },
  '& .MuiDialogContent-root': {
    color: 'var(--morius-text-secondary)',
  },
  '& .MuiInputBase-root': {
    borderRadius: '12px',
    backgroundColor: '#171d25',
    color: 'var(--morius-text-primary)',
  },
  '& .MuiInputLabel-root': {
    color: 'var(--morius-text-secondary)',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: 'color-mix(in srgb, var(--morius-card-border) 78%, transparent)',
  },
}
const DEFAULT_PLANS: CoinTopUpPlan[] = [
  { id: 'standard', title: 'Путник', description: 'Один баланс для текста, изображений, рамок и баннеров.', price_rub: 399, coins: 400 },
  { id: 'pro', title: 'Искатель', description: 'Больше запаса для длинных сессий и визуальных генераций.', price_rub: 1190, coins: 1300 },
  { id: 'mega', title: 'Архонт', description: 'Большой запас для активных миров, артов и покупок.', price_rub: 4490, coins: 5400 },
]

function isPrivilegedUser(user: AuthUser): boolean {
  const role = user.role.trim().toLowerCase()
  return role === 'administrator'
}

function normalizePlanDescription(description: string | null | undefined): string {
  const trimmed = (description ?? '').trim()
  if (!trimmed || /^\d[\d\s.,]*\s*сол(?:ов|а|ы)?$/i.test(trimmed)) {
    return 'Один баланс для текста, изображений, рамок и баннеров.'
  }
  return trimmed.replace(/(^|[^А-Яа-яЁё])сол(?:ов|а|ы)?(?=$|[^А-Яа-яЁё])/gi, '$1валюты')
}

function formatPrice(value: number): string {
  return `${Math.max(0, Math.trunc(value)).toLocaleString('ru-RU')} ₽`
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Некорректный файл'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function resolvePreviewTitle(target: PreviewTarget | null): string {
  if (!target) {
    return ''
  }
  return target.item.title
}

function ShopPage({ user, authToken, onNavigate, onUserUpdate }: ShopPageProps) {
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false)
  const [isHeaderActionsOpen, setIsHeaderActionsOpen] = useState(false)
  const [catalog, setCatalog] = useState<ShopCatalog | null>(null)
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true)
  const [error, setError] = useState('')
  const [buyingItemId, setBuyingItemId] = useState<number | null>(null)
  const [purchaseConfirmItem, setPurchaseConfirmItem] = useState<CosmeticItem | null>(null)
  const [payingPlanId, setPayingPlanId] = useState<string | null>(null)
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null)
  const [editingItem, setEditingItem] = useState<CosmeticItem | null>(null)
  const [editingPrice, setEditingPrice] = useState('')
  const [editingIsActive, setEditingIsActive] = useState(true)
  const [editingError, setEditingError] = useState('')
  const [isEditingSaving, setIsEditingSaving] = useState(false)
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null)
  const [uploadKind, setUploadKind] = useState<CosmeticItemKind>('avatar_frame')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploadPrice, setUploadPrice] = useState('25')
  const [uploadImage, setUploadImage] = useState<string>('')
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const canManageShop = isPrivilegedUser(user)

  const loadCatalog = useCallback(() => {
    setIsLoadingCatalog(true)
    setError('')
    void getShopCatalog({ token: authToken })
      .then((response) => setCatalog(response))
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить магазин')
      })
      .finally(() => setIsLoadingCatalog(false))
  }, [authToken])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  const plans = catalog?.plans.length ? catalog.plans : DEFAULT_PLANS
  const paidFrames = useMemo(() => (catalog?.avatar_frames ?? []).map(withKnownCosmeticImageUrl), [catalog?.avatar_frames])
  const paidBanners = useMemo(() => (catalog?.profile_banners ?? []).map(withKnownCosmeticImageUrl), [catalog?.profile_banners])
  const ownedSelectionIds = useMemo(() => new Set(catalog?.owned_selection_ids ?? []), [catalog?.owned_selection_ids])
  const previewAvatarUser = useMemo(() => ({ ...user, avatar_frame_id: 'none', avatar_frame_image_url: null }), [user])

  const handleBuyPlan = async (plan: CoinTopUpPlan) => {
    if (payingPlanId) {
      return
    }
    setPayingPlanId(plan.id)
    setError('')
    try {
      const response = await createCoinTopUpPayment({ token: authToken, plan_id: plan.id })
      window.location.href = response.confirmation_url
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось создать оплату')
    } finally {
      setPayingPlanId(null)
    }
  }

  const handleBuyCosmetic = async (item: CosmeticItem) => {
    if (item.is_owned || buyingItemId || !item.is_active) {
      return
    }
    setBuyingItemId(item.id)
    setError('')
    try {
      const response = await purchaseShopCosmeticItem({ token: authToken, item_id: item.id })
      onUserUpdate(response.user)
      setCatalog((previous) => {
        if (!previous) {
          return previous
        }
        const markOwned = (items: CosmeticItem[]) => items.map((entry) => (
          entry.id === item.id ? { ...entry, is_owned: true } : entry
        ))
        return {
          ...previous,
          avatar_frames: markOwned(previous.avatar_frames),
          profile_banners: markOwned(previous.profile_banners),
          owned_selection_ids: Array.from(new Set([...previous.owned_selection_ids, response.item.selection_id])),
        }
      })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось купить предмет')
    } finally {
      setBuyingItemId(null)
    }
  }

  const handleUploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    if (!/^image\/(png|webp|jpeg)$/i.test(file.type)) {
      setError('Загрузите PNG, WebP или JPEG')
      return
    }
    try {
      setUploadImage(await readFileAsDataUrl(file))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось прочитать файл')
    } finally {
      event.target.value = ''
    }
  }

  const handleCreateCosmetic = async () => {
    const normalizedTitle = uploadTitle.replace(/\s+/g, ' ').trim()
    const normalizedPrice = Number.parseInt(uploadPrice, 10)
    if (!normalizedTitle) {
      setError('Укажите название')
      return
    }
    if (!uploadImage) {
      setError('Загрузите изображение')
      return
    }
    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
      setError('Цена должна быть числом от 0')
      return
    }
    setIsUploading(true)
    setError('')
    try {
      const item = await createShopCosmeticItem({
        token: authToken,
        kind: uploadKind,
        title: normalizedTitle,
        description: uploadDescription.trim(),
        image_url: uploadImage,
        price_coins: normalizedPrice,
      })
      setCatalog((previous) => {
        if (!previous) {
          return previous
        }
        return uploadKind === 'avatar_frame'
          ? { ...previous, avatar_frames: [item, ...previous.avatar_frames] }
          : { ...previous, profile_banners: [item, ...previous.profile_banners] }
      })
      setUploadTitle('')
      setUploadDescription('')
      setUploadImage('')
      setUploadPrice('25')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось добавить предмет')
    } finally {
      setIsUploading(false)
    }
  }

  const handleOpenEditCosmetic = (item: CosmeticItem) => {
    setEditingItem(item)
    setEditingPrice(String(Math.max(1, Math.trunc(item.price_coins || 1))))
    setEditingIsActive(item.is_active)
    setEditingError('')
  }

  const handleCloseEditCosmetic = () => {
    if (isEditingSaving || deletingItemId !== null) {
      return
    }
    setEditingItem(null)
    setEditingError('')
  }

  const handleSaveEditedCosmetic = async () => {
    if (!editingItem || isEditingSaving) {
      return
    }
    const normalizedPrice = Number.parseInt(editingPrice, 10)
    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 1) {
      setEditingError('Цена должна быть числом от 1')
      return
    }
    setIsEditingSaving(true)
    setEditingError('')
    setError('')
    try {
      const updatedItem = await updateShopCosmeticItem({
        token: authToken,
        item_id: editingItem.id,
        price_coins: normalizedPrice,
        is_active: editingIsActive,
      })
      const replaceItem = (items: CosmeticItem[]) => items.map((entry) => (entry.id === updatedItem.id ? updatedItem : entry))
      setCatalog((previous) => previous
        ? {
            ...previous,
            avatar_frames: replaceItem(previous.avatar_frames),
            profile_banners: replaceItem(previous.profile_banners),
          }
        : previous)
      setPurchaseConfirmItem((previous) => (previous?.id === updatedItem.id ? updatedItem : previous))
      setPreviewTarget((previous) => (
        previous?.item.id === updatedItem.id ? { ...previous, item: updatedItem } : previous
      ))
      setEditingItem(null)
    } catch (requestError) {
      setEditingError(requestError instanceof Error ? requestError.message : 'Не удалось сохранить предмет')
    } finally {
      setIsEditingSaving(false)
    }
  }

  const handleDeleteEditedCosmetic = async () => {
    if (!editingItem || isEditingSaving || deletingItemId !== null) {
      return
    }
    const item = editingItem
    const confirmed = window.confirm(`Удалить «${item.title}» полностью? Покупки этого предмета будут удалены, а выбранное оформление у пользователей сбросится.`)
    if (!confirmed) {
      return
    }

    setDeletingItemId(item.id)
    setEditingError('')
    setError('')
    try {
      await deleteShopCosmeticItem({
        token: authToken,
        item_id: item.id,
      })
      const removeItem = (items: CosmeticItem[]) => items.filter((entry) => entry.id !== item.id)
      setCatalog((previous) => previous
        ? {
            ...previous,
            avatar_frames: removeItem(previous.avatar_frames),
            profile_banners: removeItem(previous.profile_banners),
          }
        : previous)
      setPurchaseConfirmItem((previous) => (previous?.id === item.id ? null : previous))
      setPreviewTarget((previous) => (previous?.item.id === item.id ? null : previous))
      if (item.kind === 'avatar_frame' && user.avatar_frame_id === item.selection_id) {
        onUserUpdate({ ...user, avatar_frame_id: 'none', avatar_frame_image_url: null })
      } else if (item.kind === 'profile_banner' && user.profile_banner_id === item.selection_id) {
        onUserUpdate({ ...user, profile_banner_id: 'none', profile_banner_image_url: null })
      }
      setEditingItem(null)
    } catch (requestError) {
      setEditingError(requestError instanceof Error ? requestError.message : 'Не удалось удалить предмет')
    } finally {
      setDeletingItemId(null)
    }
  }

  const renderPlanCard = (plan: CoinTopUpPlan, index: number) => {
    const accents = ['#6B9BFF', '#5ADDC7', '#F2B356']
    const accent = accents[index % accents.length]
    const isPaying = payingPlanId === plan.id
    return (
      <Box
        key={plan.id}
        sx={{
          borderRadius: '18px',
          overflow: 'hidden',
          backgroundColor: 'var(--morius-card-bg)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          boxShadow: '0 18px 42px rgba(0,0,0,0.24)',
        }}
      >
        <Box sx={{ height: 84, p: 2, background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 58%, #111 42%))` }}>
          <Typography sx={{ color: '#101317', fontSize: '1.6rem', fontWeight: 900, lineHeight: 1 }}>{plan.title}</Typography>
        </Box>
        <Stack spacing={1.4} sx={{ p: 2 }}>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '2.15rem', fontWeight: 900, lineHeight: 1 }}>
            {formatPrice(plan.price_rub)}
          </Typography>
          <SoulAmount amount={plan.coins} iconSize={18} color={accent} fontSize="1.05rem" />
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem', lineHeight: 1.45 }}>
            {normalizePlanDescription(plan.description)}
          </Typography>
          <Button
            onClick={() => void handleBuyPlan(plan)}
            disabled={isPaying}
            sx={{
              minHeight: 48,
              borderRadius: '14px',
              textTransform: 'none',
              color: '#101317',
              fontWeight: 900,
              backgroundColor: accent,
              '&:hover': { backgroundColor: `color-mix(in srgb, ${accent} 88%, #fff 12%)` },
            }}
          >
            {isPaying ? 'Открываем оплату...' : 'Купить'}
          </Button>
        </Stack>
      </Box>
    )
  }

  const renderPaidCosmeticCard = (item: CosmeticItem) => {
    const isOwned = item.is_owned || ownedSelectionIds.has(item.selection_id)
    const isBuying = buyingItemId === item.id
    const isFrame = item.kind === 'avatar_frame'
    const isUnavailable = !item.is_active
    return (
      <Box
        key={item.selection_id}
        sx={{
          position: 'relative',
          borderRadius: '16px',
          backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 82%, var(--morius-elevated-bg) 18%)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          overflow: 'hidden',
          minHeight: 268,
          display: 'flex',
          flexDirection: 'column',
          opacity: isUnavailable && !canManageShop ? 0.62 : 1,
          '&:hover .morius-shop-admin-action, &:focus-within .morius-shop-admin-action': {
            opacity: 1,
            pointerEvents: 'auto',
            transform: 'translateY(0)',
          },
        }}
      >
        {canManageShop ? (
          <Button
            className="morius-shop-admin-action"
            onClick={(event) => {
              event.stopPropagation()
              handleOpenEditCosmetic(item)
            }}
            sx={{
              position: 'absolute',
              top: 10,
              right: 10,
              zIndex: 4,
              minHeight: 32,
              px: 1,
              borderRadius: '10px',
              textTransform: 'none',
              fontSize: '0.78rem',
              fontWeight: 900,
              color: 'var(--morius-title-text)',
              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 82%, transparent)',
              backgroundColor: 'rgba(8, 12, 18, 0.82)',
              backdropFilter: 'blur(8px)',
              opacity: { xs: 1, md: 0 },
              pointerEvents: { xs: 'auto', md: 'none' },
              transform: { xs: 'none', md: 'translateY(-4px)' },
              transition: 'opacity 160ms ease, transform 160ms ease, background-color 160ms ease',
              '&:hover': {
                backgroundColor: 'rgba(18, 26, 38, 0.92)',
              },
            }}
          >
            Править
          </Button>
        ) : null}
        {isUnavailable ? (
          <Typography
            sx={{
              position: 'absolute',
              top: 10,
              left: 10,
              zIndex: 4,
              px: 0.9,
              py: 0.35,
              borderRadius: '999px',
              color: 'rgba(235, 241, 249, 0.92)',
              backgroundColor: 'rgba(10, 14, 20, 0.78)',
              border: 'var(--morius-border-width) solid rgba(235, 241, 249, 0.18)',
              fontSize: '0.72rem',
              fontWeight: 900,
            }}
          >
            Снят с продажи
          </Typography>
        ) : null}
        <ButtonBase
          onClick={() => setPreviewTarget({ kind: item.kind, item })}
          sx={{
            position: 'relative',
            height: isFrame ? 154 : 126,
            backgroundColor: 'var(--morius-elevated-bg)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {isFrame ? (
            <AvatarFrame frameId={item.selection_id} frameImageUrl={item.image_url} size={84}>
              <UserAvatar user={previewAvatarUser} size={84} />
            </AvatarFrame>
          ) : (
            <ProgressiveImage
              src={item.image_url}
              alt={item.title}
              objectFit="cover"
              loaderSize={24}
              containerSx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            />
          )}
        </ButtonBase>
        <Stack spacing={0.8} sx={{ p: 1.4, flex: 1 }}>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 900, lineHeight: 1.15 }}>
            {item.title}
          </Typography>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.88rem', lineHeight: 1.35, flex: 1 }}>
            {item.description || (isFrame ? 'Рамка для аватарки и карточек автора.' : 'Баннер для публичного профиля.')}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Typography sx={{ color: 'var(--morius-accent)', fontSize: '0.98rem', fontWeight: 900 }}>
              <SoulAmount amount={item.price_coins} iconSize={17} color="var(--morius-accent)" fontSize="0.98rem" />
            </Typography>
            <Button
              onClick={() => setPurchaseConfirmItem(item)}
              disabled={isOwned || isBuying || isUnavailable}
              sx={{
                minHeight: 38,
                px: 1.4,
                borderRadius: '12px',
                textTransform: 'none',
                fontWeight: 900,
                color: isOwned ? 'var(--morius-text-secondary)' : 'var(--morius-title-text)',
                backgroundColor: isOwned ? 'var(--morius-elevated-bg)' : 'color-mix(in srgb, var(--morius-accent) 18%, var(--morius-card-bg))',
                '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-accent) 24%, var(--morius-card-bg))' },
              }}
            >
              {isOwned ? 'Куплено' : isUnavailable ? 'Недоступно' : isBuying ? 'Покупка...' : 'Купить'}
            </Button>
          </Stack>
        </Stack>
      </Box>
    )
  }

  const previewBannerSrc = previewTarget?.kind === 'profile_banner'
    ? previewTarget.item.image_url
    : user.profile_banner_image_url ?? null
  const previewFrameId = previewTarget?.kind === 'avatar_frame'
    ? previewTarget.item.selection_id
    : user.avatar_frame_id
  const previewFrameImageUrl = previewTarget?.kind === 'avatar_frame'
    ? previewTarget.item.image_url
    : user.avatar_frame_image_url ?? null

  return (
    <Box
      className="morius-app-shell"
      sx={{
        minHeight: '100svh',
        color: 'var(--morius-text-primary)',
        background: 'radial-gradient(circle at 50% -10%, color-mix(in srgb, var(--morius-accent) 14%, transparent), transparent 34%), var(--morius-app-base)',
        overflowX: 'hidden',
      }}
    >
      <AppHeader
        isPageMenuOpen={isPageMenuOpen}
        onTogglePageMenu={() => setIsPageMenuOpen((previous) => !previous)}
        onClosePageMenu={() => setIsPageMenuOpen(false)}
        menuItems={[
          { key: 'dashboard', label: 'Главная', onClick: () => onNavigate('/dashboard') },
          { key: 'games-all', label: 'Сообщество', onClick: () => onNavigate('/games/all') },
          { key: 'games-my', label: 'Библиотека', onClick: () => onNavigate('/games') },
          { key: 'shop', label: 'Магазин', isActive: true, onClick: () => onNavigate('/shop') },
        ]}
        pageMenuLabels={{ expanded: 'Свернуть меню', collapsed: 'Открыть меню' }}
        isRightPanelOpen={isHeaderActionsOpen}
        onToggleRightPanel={() => setIsHeaderActionsOpen((previous) => !previous)}
        rightToggleLabels={{ expanded: 'Скрыть кнопки', collapsed: 'Показать кнопки' }}
        hideRightToggle
        onOpenTopUpDialog={() => onNavigate('/shop')}
        showAiAssistantAction={user.ai_assistant_visible ?? true}
        rightActions={<HeaderAccountActions user={user} authToken={authToken} avatarSize={HEADER_AVATAR_SIZE} onOpenProfile={() => onNavigate('/profile')} />}
      />

      <Box sx={{ pt: { xs: 'max(58px, calc(var(--morius-header-menu-top) - 8px))', md: 'calc(var(--morius-header-menu-top) + 18px)' }, pb: { xs: 10, md: 7 }, px: { xs: 1.6, md: 3 } }}>
        <Stack spacing={3.2} sx={{ maxWidth: 1320, mx: 'auto' }}>
          <Stack spacing={0.7}>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: { xs: '2.15rem', md: '3rem' }, fontWeight: 950, lineHeight: 1 }}>
              Магазин
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: { xs: '0.98rem', md: '1.05rem' }, lineHeight: 1.45, maxWidth: 740 }}>
              Пополните баланс и заберите платное оформление профиля: рамки аватарок и баннеры. Купленные предметы появляются в настройках профиля.
            </Typography>
          </Stack>

          {error ? <Alert severity="error" sx={{ borderRadius: '14px' }}>{error}</Alert> : null}

          <Box>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.35rem', fontWeight: 900, mb: 1.2 }}>
              Пакеты валюты
            </Typography>
            <Box sx={{ display: 'grid', gap: 1.6, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
              {plans.map(renderPlanCard)}
            </Box>
          </Box>

          {canManageShop ? (
            <Box sx={{ borderRadius: '20px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-card-bg)', p: { xs: 1.4, md: 1.8 } }}>
              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.25rem', fontWeight: 900, mb: 1 }}>
                Добавить предмет магазина
              </Typography>
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: '160px minmax(0,1fr) 130px 170px' }, alignItems: 'start' }}>
                <Stack direction="row" spacing={0.8}>
                  {(['avatar_frame', 'profile_banner'] as CosmeticItemKind[]).map((kind) => (
                    <Button
                      key={kind}
                      onClick={() => setUploadKind(kind)}
                      sx={{
                        minHeight: 42,
                        flex: 1,
                        borderRadius: '12px',
                        textTransform: 'none',
                        color: uploadKind === kind ? 'var(--morius-title-text)' : 'var(--morius-text-secondary)',
                        backgroundColor: uploadKind === kind ? 'color-mix(in srgb, var(--morius-accent) 18%, var(--morius-card-bg))' : 'var(--morius-elevated-bg)',
                      }}
                    >
                      {kind === 'avatar_frame' ? 'Рамка' : 'Баннер'}
                    </Button>
                  ))}
                </Stack>
                <Stack spacing={1}>
                  <TextField label="Название" value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value.slice(0, 80))} />
                  <TextField label="Описание" value={uploadDescription} onChange={(event) => setUploadDescription(event.target.value.slice(0, 240))} />
                </Stack>
                <TextField label="Цена" value={uploadPrice} onChange={(event) => setUploadPrice(event.target.value.replace(/\D/g, '').slice(0, 5))} />
                <Stack spacing={1}>
                  <Button onClick={() => fileInputRef.current?.click()} sx={{ minHeight: 48, borderRadius: '14px', textTransform: 'none', backgroundColor: 'var(--morius-elevated-bg)', color: 'var(--morius-title-text)' }}>
                    {uploadImage ? 'Файл выбран' : 'Загрузить PNG/WebP'}
                  </Button>
                  <Button onClick={() => void handleCreateCosmetic()} disabled={isUploading} sx={{ minHeight: 48, borderRadius: '14px', textTransform: 'none', color: 'var(--morius-title-text)', backgroundColor: 'color-mix(in srgb, var(--morius-accent) 24%, var(--morius-card-bg))' }}>
                    {isUploading ? 'Добавляем...' : 'Добавить'}
                  </Button>
                </Stack>
                <Box component="input" ref={fileInputRef} type="file" accept="image/png,image/webp,image/jpeg" onChange={handleUploadFile} sx={{ display: 'none' }} />
              </Box>
            </Box>
          ) : null}

          <Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mb: 1.2 }}>
              <Box>
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.35rem', fontWeight: 900 }}>Рамки аватарок</Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem' }}>Только покупаемые рамки для аватарок, профиля, комментариев и карточек автора.</Typography>
              </Box>
              {isLoadingCatalog ? <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>Загружаем...</Typography> : null}
            </Stack>
            <Box sx={{ display: 'grid', gap: 1.2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(5, minmax(0, 1fr))' } }}>
              {paidFrames.length > 0 ? paidFrames.map(renderPaidCosmeticCard) : (
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem' }}>Платные рамки скоро появятся.</Typography>
              )}
            </Box>
          </Box>

          <Box>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.35rem', fontWeight: 900, mb: 0.4 }}>Баннеры профиля</Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem', mb: 1.2 }}>Только покупаемые баннеры для публичного профиля.</Typography>
            <Box sx={{ display: 'grid', gap: 1.2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }}>
              {paidBanners.length > 0 ? paidBanners.map(renderPaidCosmeticCard) : (
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem' }}>Платные баннеры скоро появятся.</Typography>
              )}
            </Box>
          </Box>
        </Stack>
      </Box>

      <Dialog open={Boolean(previewTarget)} onClose={() => setPreviewTarget(null)} maxWidth="sm" fullWidth PaperProps={{ sx: SHOP_DIALOG_PAPER_SX }} BackdropProps={{ sx: { backgroundColor: 'rgba(1,4,9,0.86)' } }}>
        <DialogTitle>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography component="span" sx={{ color: 'var(--morius-title-text)', fontSize: '1.35rem', fontWeight: 900 }}>
              {resolvePreviewTitle(previewTarget)}
            </Typography>
            <IconButton onClick={() => setPreviewTarget(null)} sx={{ color: 'var(--morius-text-secondary)' }}>×</IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Box
            sx={{
              position: 'relative',
              overflow: 'hidden',
              minHeight: 290,
              borderRadius: '20px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-card-bg)',
            }}
          >
            <Box sx={{ position: 'relative', height: 146, background: 'linear-gradient(135deg, var(--morius-elevated-bg), var(--morius-card-bg))' }}>
              {previewBannerSrc ? (
                <ProgressiveImage
                  src={previewBannerSrc}
                  alt=""
                  objectFit="cover"
                  loaderSize={24}
                  containerSx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                />
              ) : null}
            </Box>
            <Stack spacing={1} sx={{ p: 2, pt: 0, alignItems: 'center', textAlign: 'center', transform: 'translateY(-34px)', mb: '-24px' }}>
              <AvatarFrame frameId={previewFrameId} frameImageUrl={previewFrameImageUrl} size={96}>
                <UserAvatar user={previewAvatarUser} size={96} />
              </AvatarFrame>
              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.28rem', fontWeight: 950 }}>{user.display_name || 'Игрок MoRius'}</Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem', lineHeight: 1.45, maxWidth: 420 }}>
                Так оформление будет выглядеть в профиле, карточках автора и комментариях.
              </Typography>
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button onClick={() => setPreviewTarget(null)} sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--morius-text-secondary)' }}>Закрыть</Button>
          {previewTarget ? (
          <Button
            onClick={() => setPurchaseConfirmItem(previewTarget.item)}
            disabled={previewTarget.item.is_owned || ownedSelectionIds.has(previewTarget.item.selection_id) || buyingItemId === previewTarget.item.id || !previewTarget.item.is_active}
            sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--morius-title-text)', backgroundColor: 'color-mix(in srgb, var(--morius-accent) 22%, var(--morius-card-bg))' }}
          >
            {previewTarget.item.is_owned || ownedSelectionIds.has(previewTarget.item.selection_id) ? (
              'Уже куплено'
            ) : !previewTarget.item.is_active ? (
              'Снят с продажи'
            ) : (
              <Stack component="span" direction="row" spacing={0.65} alignItems="center">
                <Box component="span">Купить за</Box>
                <SoulAmount amount={previewTarget.item.price_coins} iconSize={16} />
              </Stack>
            )}
          </Button>
          ) : null}
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(purchaseConfirmItem)} onClose={() => setPurchaseConfirmItem(null)} maxWidth="xs" fullWidth PaperProps={{ sx: SHOP_DIALOG_PAPER_SX }} BackdropProps={{ sx: { backgroundColor: 'rgba(1,4,9,0.86)' } }}>
        <DialogTitle sx={{ color: 'var(--morius-title-text)', fontWeight: 900 }}>
          Подтвердить покупку
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'var(--morius-text-secondary)', lineHeight: 1.55 }}>
            Купить «{purchaseConfirmItem?.title ?? ''}» за <SoulAmount amount={purchaseConfirmItem?.price_coins ?? 0} iconSize={16} />?
            Списание произойдет сразу после подтверждения.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button
            onClick={() => setPurchaseConfirmItem(null)}
            disabled={buyingItemId !== null}
            sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--morius-text-secondary)' }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => {
              if (!purchaseConfirmItem) {
                return
              }
              const item = purchaseConfirmItem
              setPurchaseConfirmItem(null)
              void handleBuyCosmetic(item)
            }}
            disabled={!purchaseConfirmItem || buyingItemId !== null || !purchaseConfirmItem.is_active}
            sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--morius-title-text)', backgroundColor: 'color-mix(in srgb, var(--morius-accent) 24%, var(--morius-card-bg))' }}
          >
            Купить
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(editingItem)} onClose={handleCloseEditCosmetic} maxWidth="xs" fullWidth PaperProps={{ sx: SHOP_DIALOG_PAPER_SX }} BackdropProps={{ sx: { backgroundColor: 'rgba(1,4,9,0.86)' } }}>
        <DialogTitle sx={{ color: 'var(--morius-title-text)', fontWeight: 900 }}>
          Редактировать предмет
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.3} sx={{ pt: 0.4 }}>
            <Typography sx={{ color: 'var(--morius-text-secondary)', lineHeight: 1.45 }}>
              {editingItem?.title ?? ''}
            </Typography>
            <TextField
              label="Цена в валюте"
              value={editingPrice}
              onChange={(event) => setEditingPrice(event.target.value.replace(/\D/g, '').slice(0, 6))}
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={editingIsActive}
                  onChange={(event) => setEditingIsActive(event.target.checked)}
                />
              }
              label={editingIsActive ? 'В продаже' : 'Снят с продажи'}
              sx={{ color: 'var(--morius-text-primary)' }}
            />
            {editingError ? <Alert severity="error">{editingError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button
            onClick={() => void handleDeleteEditedCosmetic()}
            disabled={!editingItem || isEditingSaving || deletingItemId !== null}
            sx={{
              mr: 'auto',
              borderRadius: '12px',
              textTransform: 'none',
              color: 'rgba(255,194,194,0.96)',
              border: 'var(--morius-border-width) solid rgba(255,107,107,0.34)',
              backgroundColor: 'rgba(255,107,107,0.08)',
              '&:hover': {
                backgroundColor: 'rgba(255,107,107,0.14)',
                borderColor: 'rgba(255,107,107,0.52)',
              },
            }}
          >
            {editingItem && deletingItemId === editingItem.id ? 'Удаляем...' : 'Удалить полностью'}
          </Button>
          <Button
            onClick={handleCloseEditCosmetic}
            disabled={isEditingSaving || deletingItemId !== null}
            sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--morius-text-secondary)' }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => void handleSaveEditedCosmetic()}
            disabled={!editingItem || isEditingSaving || deletingItemId !== null}
            sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--morius-title-text)', backgroundColor: 'color-mix(in srgb, var(--morius-accent) 24%, var(--morius-card-bg))' }}
          >
            {isEditingSaving ? 'Сохраняем...' : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default ShopPage
