import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Link,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import AppHeader from '../components/AppHeader'
import HeaderAccountActions from '../components/HeaderAccountActions'
import SoulAmount from '../components/currency/SoulAmount'
import ProgressiveImage from '../components/media/ProgressiveImage'
import UserAvatar from '../components/profile/UserAvatar'
import AvatarFrame from '../components/profile/AvatarFrame'
import {
  cancelSubscription,
  createCoinTopUpPayment,
  createDemoPaymentMethod,
  createMockSubscription,
  createSubscriptionCheckout,
  deleteSavedPaymentMethod,
  deleteShopCosmeticItem,
  createShopCosmeticItem,
  getSavedPaymentMethods,
  getShopCatalog,
  getSubscriptionPlans,
  getSubscriptions,
  purchaseShopCosmeticItem,
  updateShopCosmeticItem,
  type CoinTopUpPlan,
  type CosmeticItem,
  type CosmeticItemKind,
  type SavedPaymentMethod,
  type ShopCatalog,
  type SubscriptionDetail,
  type SubscriptionPlan,
} from '../services/authApi'
import type { AuthUser } from '../types/auth'
import { moriusThemeTokens } from '../theme'
import { withKnownCosmeticImageUrl } from '../utils/cosmeticImageFallbacks'

type CosmeticSortMode = 'newest' | 'price'

const SHOP_SHOW_MORE_BUTTON_SX = {
  minHeight: 46,
  px: 3,
  borderRadius: '14px',
  textTransform: 'none',
  fontWeight: 800,
  fontSize: '0.95rem',
  color: 'var(--morius-title-text)',
  border: 'var(--morius-border-width) solid var(--morius-card-border)',
  backgroundColor: 'var(--morius-elevated-bg)',
  '&:hover': { backgroundColor: 'var(--morius-button-hover)', borderColor: 'var(--morius-hover-border)' },
} as const

function sortCosmetics(items: CosmeticItem[], mode: CosmeticSortMode): CosmeticItem[] {
  const sorted = [...items]
  sorted.sort((a, b) => {
    if (mode === 'price' && a.price_coins !== b.price_coins) {
      return a.price_coins - b.price_coins
    }
    if (mode === 'newest') {
      const aTime = a.created_at ? Date.parse(a.created_at) : 0
      const bTime = b.created_at ? Date.parse(b.created_at) : 0
      if (aTime !== bTime) {
        return bTime - aTime
      }
    }
    return b.id - a.id
  })
  return sorted
}

function CosmeticSortToggle({ value, onChange }: { value: CosmeticSortMode; onChange: (mode: CosmeticSortMode) => void }) {
  const options: Array<{ key: CosmeticSortMode; label: string }> = [
    { key: 'newest', label: 'По новизне' },
    { key: 'price', label: 'По цене' },
  ]
  return (
    <Stack
      direction="row"
      spacing={0.4}
      sx={{
        p: 0.4,
        borderRadius: '12px',
        border: 'var(--morius-border-width) solid var(--morius-card-border)',
        backgroundColor: 'var(--morius-elevated-bg)',
        flexShrink: 0,
      }}
    >
      {options.map((option) => {
        const active = value === option.key
        return (
          <Button
            key={option.key}
            onClick={() => onChange(option.key)}
            sx={{
              minHeight: 32,
              px: 1.2,
              borderRadius: '9px',
              textTransform: 'none',
              fontSize: '0.82rem',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              color: active ? 'var(--morius-title-text)' : 'var(--morius-text-secondary)',
              backgroundColor: active ? 'color-mix(in srgb, var(--morius-accent) 22%, var(--morius-card-bg))' : 'transparent',
              '&:hover': {
                backgroundColor: active ? 'color-mix(in srgb, var(--morius-accent) 26%, var(--morius-card-bg))' : 'var(--morius-button-hover)',
              },
            }}
          >
            {option.label}
          </Button>
        )
      })}
    </Stack>
  )
}

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
  backgroundColor: '#070a0f',
  backgroundImage: 'none',
  color: 'var(--morius-text-primary)',
  boxShadow: '0 28px 80px rgba(0,0,0,0.85)',
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
  { id: 'pro', title: 'Искатель', description: 'Больше запаса для длинных сессий и визуальных генераций.', price_rub: 1190, coins: 1290 },
  { id: 'mega', title: 'Архонт', description: 'Большой запас для активных миров, артов и покупок.', price_rub: 2990, coins: 3350 },
  { id: 'legendary', title: 'Летописец', description: 'Максимальный запас для хронистов: дорогие модели, долгие кампании.', price_rub: 5990, coins: 7000 },
]

const DEFAULT_SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'spark',
    title: 'Искра',
    subtitle: 'Для регулярной игры без оглядки на счётчик',
    price_rub: 299,
    period: 'month',
    monthly_coins: 0,
    models: ['deepseek/deepseek-v4-flash', 'google/gemini-2.5-flash-lite'],
    daily_turn_limit: 40,
    memory_token_cap: 8000,
    perks: [
      '2 модели для отыгрыша: DeepSeek V4 Flash и Gemini 2.5 Flash Lite',
      'До 40 ходов в день на этих моделях — без списания солов',
      'Память сцены до 8K токенов',
    ],
    badge: null,
  },
  {
    id: 'flame',
    title: 'Пламя',
    subtitle: 'Расширенный доступ для активных хронистов',
    price_rub: 599,
    period: 'month',
    monthly_coins: 0,
    models: ['deepseek/deepseek-v4-flash', 'google/gemini-2.5-flash-lite', 'z-ai/glm-4.5-air'],
    daily_turn_limit: 60,
    memory_token_cap: 20000,
    perks: [
      '3 модели: DeepSeek V4 Flash, Gemini 2.5 Flash Lite и GLM 4.5 Air',
      'До 60 ходов в день на этих моделях — без списания солов',
      'Память сцены до 20K токенов',
    ],
    badge: 'Популярный',
  },
  {
    id: 'constellation',
    title: 'Созвездие',
    subtitle: 'Максимум памяти и лучшие модели',
    price_rub: 1190,
    period: 'month',
    monthly_coins: 0,
    models: [
      'deepseek/deepseek-v4-flash',
      'google/gemini-2.5-flash-lite',
      'z-ai/glm-4.5-air',
      'google/gemini-3-flash-preview',
    ],
    daily_turn_limit: 90,
    memory_token_cap: 32000,
    perks: [
      '4 модели: DeepSeek V4 Flash, Gemini 2.5 Flash Lite, GLM 4.5 Air и Gemini 3 Flash Preview',
      'До 90 ходов в день на этих моделях — без списания солов',
      'Память сцены до 32K токенов',
    ],
    badge: null,
  },
]

const RECURRING_TERMS_PARAGRAPHS: readonly string[] = [
  'Подписка MoRius — это регулярная (рекуррентная) услуга с автоматическим продлением. Оформляя подписку, вы соглашаетесь на периодическое автоматическое списание её стоимости с привязанной банковской карты.',
  'Стоимость и период. Списание производится раз в месяц в размере, указанном в выбранном тарифе. Первое списание выполняется в момент оформления, последующие — каждые 30 дней до отмены подписки.',
  'Привязка карты. Для автосписаний платёжные данные карты сохраняются на стороне платёжного провайдера ЮKassa. MoRius не хранит и не обрабатывает полные реквизиты банковских карт.',
  'Отмена и отвязка карты. Вы можете в любой момент отменить подписку и отвязать карту в разделе «Магазин» → «Способы оплаты». После отвязки карты автоматические списания по ней прекращаются, повторная оплата без вашего согласия невозможна.',
  'Возобновление. Доступ по подписке действует до конца оплаченного периода. После отмены ранее списанные средства за уже предоставленный период не возвращаются.',
  'Согласие. Нажимая «Перейти к оплате», вы подтверждаете согласие с настоящими условиями, Пользовательским соглашением и Политикой конфиденциальности, а также даёте согласие на регулярные автоматические списания.',
]

function isPrivilegedUser(user: AuthUser): boolean {
  const role = user.role.trim().toLowerCase()
  return role === 'administrator' || role === 'moderator'
}

function formatPricePerMonth(value: number): string {
  return `${formatPrice(value)} / мес`
}

function formatNextChargeDate(): string {
  const next = new Date()
  next.setMonth(next.getMonth() + 1)
  return next.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatDateRu(iso: string | null): string {
  if (!iso) {
    return '—'
  }
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) {
    return '—'
  }
  return parsed.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatCardNumberInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 19)
  return digits.replace(/(.{4})/g, '$1 ').trim()
}

function formatCardExpiryInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) {
    return digits
  }
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
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
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>(DEFAULT_SUBSCRIPTION_PLANS)
  const [subscriptionsEnabled, setSubscriptionsEnabled] = useState(false)
  const [subscribePlan, setSubscribePlan] = useState<SubscriptionPlan | null>(null)
  const [subscribeConsent, setSubscribeConsent] = useState(false)
  const [subscribeInfo, setSubscribeInfo] = useState(false)
  const [isTermsOpen, setIsTermsOpen] = useState(false)
  const [isCardsOpen, setIsCardsOpen] = useState(false)
  const [paymentMethods, setPaymentMethods] = useState<SavedPaymentMethod[]>([])
  const [isLoadingMethods, setIsLoadingMethods] = useState(false)
  const [subscriptions, setSubscriptions] = useState<SubscriptionDetail[]>([])
  const [unbindConsent, setUnbindConsent] = useState<Record<number, boolean>>({})
  const [unbindMethod, setUnbindMethod] = useState<SavedPaymentMethod | null>(null)
  const [deletingMethodId, setDeletingMethodId] = useState<number | null>(null)
  const [isCreatingDemoCard, setIsCreatingDemoCard] = useState(false)
  const [checkoutPlan, setCheckoutPlan] = useState<SubscriptionPlan | null>(null)
  const [checkoutNumber, setCheckoutNumber] = useState('')
  const [checkoutExpiry, setCheckoutExpiry] = useState('')
  const [checkoutCvc, setCheckoutCvc] = useState('')
  const [checkoutHolder, setCheckoutHolder] = useState('')
  const [checkoutError, setCheckoutError] = useState('')
  const [isPaying, setIsPaying] = useState(false)
  const [justSubscribed, setJustSubscribed] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<SubscriptionDetail | null>(null)
  const [cancelingId, setCancelingId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const canManageShop = isPrivilegedUser(user)
  const isAdmin = user.role.trim().toLowerCase() === 'administrator'
  // Subscriptions are previewable/testable ONLY by an administrator before ЮKassa launch.
  // Players and moderators see "Скоро добавим" until SUBSCRIPTIONS_ENABLED is flipped on.
  const subscriptionsAvailable = subscriptionsEnabled || isAdmin

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

  const loadPaymentMethods = useCallback(() => {
    setIsLoadingMethods(true)
    void getSavedPaymentMethods({ token: authToken })
      .then((response) => {
        setPaymentMethods(response.methods)
        setSubscriptionsEnabled(response.subscriptions_enabled)
      })
      .catch(() => {
        // Silent: an empty card list is a valid, expected state before any subscription.
      })
      .finally(() => setIsLoadingMethods(false))
  }, [authToken])

  const loadSubscriptions = useCallback(() => {
    void getSubscriptions({ token: authToken })
      .then((response) => setSubscriptions(response.subscriptions))
      .catch(() => {
        // Silent: no subscriptions yet is a valid state.
      })
  }, [authToken])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  useEffect(() => {
    void getSubscriptionPlans()
      .then((response) => {
        if (response.plans.length) {
          setSubscriptionPlans(response.plans)
        }
        setSubscriptionsEnabled(response.enabled)
      })
      .catch(() => {
        // Fall back to the bundled default plans if the endpoint is unavailable.
      })
  }, [])

  useEffect(() => {
    if (isAdmin || subscriptionsEnabled) {
      loadPaymentMethods()
      loadSubscriptions()
    }
  }, [isAdmin, subscriptionsEnabled, loadPaymentMethods, loadSubscriptions])

  // Deep link from the profile "Управление подпиской и картами" button: open card management
  // (отмена автопродления / отвязка карты) in one click.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const params = new URLSearchParams(window.location.search)
    if (params.get('manage') !== 'cards') {
      return
    }
    setUnbindConsent({})
    setJustSubscribed(false)
    setIsCardsOpen(true)
    loadPaymentMethods()
    loadSubscriptions()
    params.delete('manage')
    const nextSearch = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`)
  }, [loadPaymentMethods, loadSubscriptions])

  const plans = catalog?.plans.length ? catalog.plans : DEFAULT_PLANS
  const paidFrames = useMemo(() => (catalog?.avatar_frames ?? []).map(withKnownCosmeticImageUrl), [catalog?.avatar_frames])
  const paidBanners = useMemo(() => (catalog?.profile_banners ?? []).map(withKnownCosmeticImageUrl), [catalog?.profile_banners])
  // Cosmetic sections: 2 rows shown by default, "Показать больше" loads +2 rows, with a per-section sort.
  const isShopSm = useMediaQuery('(min-width:600px)')
  const isShopLg = useMediaQuery('(min-width:1200px)')
  const framesPerRow = isShopLg ? 5 : isShopSm ? 3 : 2
  const bannersPerRow = isShopLg ? 4 : isShopSm ? 2 : 1
  const [framesSort, setFramesSort] = useState<CosmeticSortMode>('newest')
  const [bannersSort, setBannersSort] = useState<CosmeticSortMode>('newest')
  const [framesVisibleRows, setFramesVisibleRows] = useState(2)
  const [bannersVisibleRows, setBannersVisibleRows] = useState(2)
  const sortedFrames = useMemo(() => sortCosmetics(paidFrames, framesSort), [paidFrames, framesSort])
  const sortedBanners = useMemo(() => sortCosmetics(paidBanners, bannersSort), [paidBanners, bannersSort])
  const visibleFrames = useMemo(
    () => sortedFrames.slice(0, framesPerRow * framesVisibleRows),
    [sortedFrames, framesPerRow, framesVisibleRows],
  )
  const visibleBanners = useMemo(
    () => sortedBanners.slice(0, bannersPerRow * bannersVisibleRows),
    [sortedBanners, bannersPerRow, bannersVisibleRows],
  )
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

  const handleOpenSubscribe = (plan: SubscriptionPlan) => {
    setSubscribeConsent(false)
    setSubscribeInfo(false)
    setSubscribePlan(plan)
  }

  const handleCloseSubscribe = () => {
    setSubscribePlan(null)
    setSubscribeConsent(false)
    setSubscribeInfo(false)
  }

  const handleStartSubscription = () => {
    if (!subscribePlan || !subscribeConsent) {
      return
    }
    // Administrators keep an internal mock checkout (no real charge) for quick UI/screenshot tests;
    // everyone else goes through the real ЮKassa redirect checkout that saves the card for renewals.
    if (isAdmin) {
      handleOpenCheckout(subscribePlan)
      return
    }
    void startRealSubscriptionCheckout(subscribePlan)
  }

  const startRealSubscriptionCheckout = async (plan: SubscriptionPlan) => {
    if (isPaying) {
      return
    }
    setIsPaying(true)
    setError('')
    try {
      const response = await createSubscriptionCheckout({ token: authToken, plan_id: plan.id })
      window.location.href = response.confirmation_url
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось перейти к оплате подписки')
      setIsPaying(false)
    }
  }

  const handleOpenCheckout = (plan: SubscriptionPlan) => {
    setCheckoutPlan(plan)
    setCheckoutNumber('')
    setCheckoutExpiry('')
    setCheckoutCvc('')
    setCheckoutHolder('')
    setCheckoutError('')
  }

  const handleCloseCheckout = () => {
    if (isPaying) {
      return
    }
    setCheckoutPlan(null)
  }

  const handlePayCheckout = async () => {
    if (!checkoutPlan || isPaying) {
      return
    }
    const digits = checkoutNumber.replace(/\D/g, '')
    if (digits.length < 12) {
      setCheckoutError('Введите номер карты')
      return
    }
    if (!/^\d{2}\/?\d{2}$/.test(checkoutExpiry.replace(/\s/g, ''))) {
      setCheckoutError('Срок действия в формате ММ/ГГ')
      return
    }
    if (checkoutCvc.replace(/\D/g, '').length < 3) {
      setCheckoutError('Введите CVC')
      return
    }
    setIsPaying(true)
    setCheckoutError('')
    try {
      await createMockSubscription({
        token: authToken,
        plan_id: checkoutPlan.id,
        card_number: digits,
        card_expiry: checkoutExpiry,
        card_holder: checkoutHolder.trim(),
      })
      loadPaymentMethods()
      loadSubscriptions()
      setCheckoutPlan(null)
      setSubscribePlan(null)
      setSubscribeConsent(false)
      setUnbindConsent({})
      setJustSubscribed(true)
      setIsCardsOpen(true)
    } catch (requestError) {
      setCheckoutError(requestError instanceof Error ? requestError.message : 'Не удалось провести оплату')
    } finally {
      setIsPaying(false)
    }
  }

  const handleCancelSubscription = async () => {
    if (!cancelTarget || cancelingId !== null) {
      return
    }
    const target = cancelTarget
    setCancelingId(target.id)
    setError('')
    try {
      const updated = await cancelSubscription({ token: authToken, subscription_id: target.id })
      setSubscriptions((previous) => previous.map((entry) => (entry.id === updated.id ? updated : entry)))
      setCancelTarget(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось отменить подписку')
    } finally {
      setCancelingId(null)
    }
  }

  const handleOpenCards = () => {
    setUnbindConsent({})
    setJustSubscribed(false)
    setIsCardsOpen(true)
    loadPaymentMethods()
    loadSubscriptions()
  }

  const handleCreateDemoCard = async () => {
    if (isCreatingDemoCard) {
      return
    }
    setIsCreatingDemoCard(true)
    setError('')
    try {
      const method = await createDemoPaymentMethod({ token: authToken })
      setPaymentMethods((previous) => [method, ...previous])
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось добавить карту')
    } finally {
      setIsCreatingDemoCard(false)
    }
  }

  const handleConfirmUnbind = async () => {
    if (!unbindMethod || deletingMethodId !== null) {
      return
    }
    const method = unbindMethod
    setDeletingMethodId(method.id)
    setError('')
    try {
      await deleteSavedPaymentMethod({ token: authToken, method_id: method.id })
      setPaymentMethods((previous) => previous.filter((entry) => entry.id !== method.id))
      setUnbindConsent((previous) => {
        const next = { ...previous }
        delete next[method.id]
        return next
      })
      loadSubscriptions()
      setUnbindMethod(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось отвязать карту')
    } finally {
      setDeletingMethodId(null)
    }
  }

  const renderSubscriptionCard = (plan: SubscriptionPlan, index: number) => {
    const accents = ['#6B9BFF', '#C47FFF', '#F2B356']
    const accent = accents[index % accents.length]
    const isLocked = !subscriptionsAvailable
    return (
      <Box
        key={plan.id}
        sx={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '18px',
          overflow: 'hidden',
          backgroundColor: 'var(--morius-card-bg)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          boxShadow: '0 18px 42px rgba(0,0,0,0.24)',
          opacity: isLocked ? 0.78 : 1,
        }}
      >
        {plan.badge ? (
          <Chip
            label={plan.badge}
            size="small"
            sx={{
              position: 'absolute',
              top: 12,
              right: 12,
              zIndex: 3,
              height: 24,
              fontWeight: 900,
              fontSize: '0.72rem',
              color: '#101317',
              backgroundColor: accent,
            }}
          />
        ) : null}
        <Box sx={{ p: 2, pb: 1.6, background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 26%, var(--morius-card-bg)), var(--morius-card-bg))` }}>
          <Typography sx={{ color: accent, fontSize: '0.82rem', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Подписка
          </Typography>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.7rem', fontWeight: 950, lineHeight: 1.05, mt: 0.4 }}>
            {plan.title}
          </Typography>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', lineHeight: 1.35, mt: 0.4 }}>
            {plan.subtitle}
          </Typography>
        </Box>
        <Stack spacing={1.4} sx={{ p: 2, pt: 1.6, flex: 1 }}>
          <Stack direction="row" alignItems="baseline" spacing={0.6}>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '2rem', fontWeight: 950, lineHeight: 1 }}>
              {formatPrice(plan.price_rub)}
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem', fontWeight: 700 }}>/ мес</Typography>
          </Stack>
          <Stack spacing={0.9} sx={{ flex: 1 }}>
            {plan.perks.map((perk) => (
              <Stack key={perk} direction="row" spacing={1} alignItems="flex-start">
                <Box component="span" sx={{ color: accent, fontWeight: 900, lineHeight: 1.4, flexShrink: 0 }}>✓</Box>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.92rem', lineHeight: 1.4 }}>{perk}</Typography>
              </Stack>
            ))}
          </Stack>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.4, opacity: 0.85 }}>
            Автопродление каждый месяц. Отмена в любой момент в разделе «Способы оплаты».
          </Typography>
          <Button
            onClick={() => handleOpenSubscribe(plan)}
            disabled={isLocked}
            sx={{
              minHeight: 48,
              borderRadius: '14px',
              textTransform: 'none',
              color: isLocked ? 'var(--morius-text-secondary)' : '#101317',
              fontWeight: 900,
              backgroundColor: isLocked ? 'var(--morius-elevated-bg)' : accent,
              '&.Mui-disabled': { color: 'var(--morius-text-secondary)', backgroundColor: 'var(--morius-elevated-bg)' },
              '&:hover': { backgroundColor: `color-mix(in srgb, ${accent} 88%, #fff 12%)` },
            }}
          >
            {isLocked ? 'Скоро добавим' : `Оформить за ${formatPricePerMonth(plan.price_rub)}`}
          </Button>
        </Stack>
      </Box>
    )
  }

  const renderPlanCard = (plan: CoinTopUpPlan, index: number) => {
    const accents = ['#6B9BFF', '#5ADDC7', '#F2B356', '#C47FFF']
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
          <SoulAmount amount={plan.coins} iconSize={20} color={accent} fontSize="1.05rem" />
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
              <UserAvatar user={previewAvatarUser} size={84} withFrame={false} />
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
              <SoulAmount amount={item.price_coins} iconSize={19} color="var(--morius-accent)" fontSize="0.98rem" />
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

      <Box sx={{ pt: { xs: 'max(58px, calc(var(--morius-header-menu-top) - 8px))', md: 'calc(var(--morius-header-menu-top) + 18px)' }, pb: { xs: 'calc(118px + env(safe-area-inset-bottom))', md: 7 }, px: { xs: 1.6, md: 3 } }}>
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
            <Box sx={{ display: 'grid', gap: 1.6, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' } }}>
              {plans.map(renderPlanCard)}
            </Box>
          </Box>

          <Box>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', sm: 'flex-end' }}
              sx={{ mb: 1.2 }}
            >
              <Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.6 }}>
                  <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.35rem', fontWeight: 900 }}>
                    Подписки
                  </Typography>
                  {!subscriptionsAvailable ? (
                    <Chip label="Скоро добавим" size="small" sx={{ height: 24, fontWeight: 900, fontSize: '0.72rem', color: 'var(--morius-title-text)', backgroundColor: 'var(--morius-elevated-bg)' }} />
                  ) : null}
                </Stack>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem', lineHeight: 1.45, maxWidth: 760, mt: 0.4 }}>
                  Подписка открывает доступ к отдельным моделям рассказчика, даёт лимит ходов в день на этих моделях без списания солов и увеличивает память сцены. Автопродление раз в месяц, отмена и отвязка карты — в любой момент.
                </Typography>
              </Box>
              {subscriptionsAvailable ? (
                <Button
                  onClick={handleOpenCards}
                  sx={{
                    flexShrink: 0,
                    minHeight: 44,
                    px: 2,
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 900,
                    color: 'var(--morius-title-text)',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-elevated-bg)',
                    '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-accent) 16%, var(--morius-elevated-bg))' },
                  }}
                >
                  Способы оплаты
                </Button>
              ) : null}
            </Stack>
            <Box sx={{ display: 'grid', gap: 1.6, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
              {subscriptionPlans.map(renderSubscriptionCard)}
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
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.35rem', fontWeight: 900 }}>Рамки аватарок</Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem' }}>Только покупаемые рамки для аватарок, профиля, комментариев и карточек автора.</Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                {isLoadingCatalog ? <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>Загружаем...</Typography> : null}
                {sortedFrames.length > 1 ? (
                  <CosmeticSortToggle value={framesSort} onChange={(mode) => { setFramesSort(mode); setFramesVisibleRows(2) }} />
                ) : null}
              </Stack>
            </Stack>
            <Box sx={{ display: 'grid', gap: 1.2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(5, minmax(0, 1fr))' } }}>
              {sortedFrames.length > 0 ? visibleFrames.map(renderPaidCosmeticCard) : (
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem' }}>Платные рамки скоро появятся.</Typography>
              )}
            </Box>
            {visibleFrames.length < sortedFrames.length ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.6 }}>
                <Button
                  onClick={() => setFramesVisibleRows((rows) => rows + 2)}
                  sx={SHOP_SHOW_MORE_BUTTON_SX}
                >
                  Показать больше
                </Button>
              </Box>
            ) : null}
          </Box>

          <Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mb: 1.2 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.35rem', fontWeight: 900 }}>Баннеры профиля</Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem' }}>Только покупаемые баннеры для публичного профиля.</Typography>
              </Box>
              {sortedBanners.length > 1 ? (
                <CosmeticSortToggle value={bannersSort} onChange={(mode) => { setBannersSort(mode); setBannersVisibleRows(2) }} />
              ) : null}
            </Stack>
            <Box sx={{ display: 'grid', gap: 1.2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }}>
              {sortedBanners.length > 0 ? visibleBanners.map(renderPaidCosmeticCard) : (
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem' }}>Платные баннеры скоро появятся.</Typography>
              )}
            </Box>
            {visibleBanners.length < sortedBanners.length ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.6 }}>
                <Button
                  onClick={() => setBannersVisibleRows((rows) => rows + 2)}
                  sx={SHOP_SHOW_MORE_BUTTON_SX}
                >
                  Показать больше
                </Button>
              </Box>
            ) : null}
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
                <UserAvatar user={previewAvatarUser} size={96} withFrame={false} />
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
                <SoulAmount amount={previewTarget.item.price_coins} iconSize={18} />
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
            Купить «{purchaseConfirmItem?.title ?? ''}» за <SoulAmount amount={purchaseConfirmItem?.price_coins ?? 0} iconSize={18} />?
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

      <Dialog open={Boolean(subscribePlan)} onClose={handleCloseSubscribe} maxWidth="xs" fullWidth PaperProps={{ sx: SHOP_DIALOG_PAPER_SX }} BackdropProps={{ sx: { backgroundColor: 'rgba(1,4,9,0.86)' } }}>
        <DialogTitle sx={{ color: 'var(--morius-title-text)', fontWeight: 900 }}>
          Оформление подписки «{subscribePlan?.title ?? ''}»
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.6} sx={{ pt: 0.4 }}>
            <Stack direction="row" alignItems="baseline" spacing={0.6}>
              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.8rem', fontWeight: 950, lineHeight: 1 }}>
                {formatPrice(subscribePlan?.price_rub ?? 0)}
              </Typography>
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.95rem', fontWeight: 700 }}>/ мес</Typography>
            </Stack>
            {subscribePlan ? (
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.4 }}>
                {subscribePlan.models.length} модел{subscribePlan.models.length === 1 ? 'ь' : (subscribePlan.models.length < 5 ? 'и' : 'ей')} по подписке · до {subscribePlan.daily_turn_limit} ходов/день · память до {Math.round(subscribePlan.memory_token_cap / 1000)}K токенов
              </Typography>
            ) : null}
            <Box sx={{ borderRadius: '14px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-elevated-bg)', p: 1.4 }}>
              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.95rem', fontWeight: 900, mb: 0.8 }}>
                Условия списания
              </Typography>
              <Stack spacing={0.6}>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.88rem', lineHeight: 1.4 }}>
                  • Стоимость: {formatPrice(subscribePlan?.price_rub ?? 0)} в месяц
                </Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.88rem', lineHeight: 1.4 }}>
                  • Первое списание — сегодня, далее ежемесячно
                </Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.88rem', lineHeight: 1.4 }}>
                  • Следующее списание: {formatNextChargeDate()}
                </Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.88rem', lineHeight: 1.4 }}>
                  • Автопродление можно отключить и отвязать карту в любой момент в разделе «Способы оплаты»
                </Typography>
              </Stack>
            </Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={subscribeConsent}
                  onChange={(event) => setSubscribeConsent(event.target.checked)}
                  sx={{ color: 'var(--morius-text-secondary)', '&.Mui-checked': { color: 'var(--morius-accent)' } }}
                />
              }
              label={
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem', lineHeight: 1.4 }}>
                  Я согласен(на) на регулярные автоматические списания {formatPrice(subscribePlan?.price_rub ?? 0)} в месяц и принимаю условия подписки.
                </Typography>
              }
              sx={{ alignItems: 'flex-start', m: 0 }}
            />
            <Link
              component="button"
              type="button"
              onClick={() => setIsTermsOpen(true)}
              sx={{ alignSelf: 'flex-start', color: 'var(--morius-accent)', fontSize: '0.84rem', fontWeight: 700 }}
            >
              Читать условия подписки и автосписаний
            </Link>
            {subscribeInfo ? (
              <Alert severity="info" sx={{ borderRadius: '12px' }}>
                Оформление готово. Оплата подписок включится автоматически после одобрения автоплатежей ЮKassa — повторно настраивать ничего не нужно.
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button onClick={handleCloseSubscribe} sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--morius-text-secondary)' }}>
            Отмена
          </Button>
          <Button
            onClick={handleStartSubscription}
            disabled={!subscribeConsent || subscribeInfo}
            sx={{
              borderRadius: '12px',
              textTransform: 'none',
              fontWeight: 900,
              color: 'var(--morius-title-text)',
              backgroundColor: 'color-mix(in srgb, var(--morius-accent) 24%, var(--morius-card-bg))',
              '&.Mui-disabled': { color: 'var(--morius-text-secondary)' },
            }}
          >
            Перейти к оплате
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={isTermsOpen} onClose={() => setIsTermsOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: SHOP_DIALOG_PAPER_SX }} BackdropProps={{ sx: { backgroundColor: 'rgba(1,4,9,0.86)' } }}>
        <DialogTitle>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography component="span" sx={{ color: 'var(--morius-title-text)', fontSize: '1.2rem', fontWeight: 900 }}>
              Условия подписки и автосписаний
            </Typography>
            <IconButton onClick={() => setIsTermsOpen(false)} sx={{ color: 'var(--morius-text-secondary)' }}>×</IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.2} sx={{ pt: 0.4 }}>
            {RECURRING_TERMS_PARAGRAPHS.map((paragraph, index) => (
              <Typography key={index} sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', lineHeight: 1.55 }}>
                {paragraph}
              </Typography>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Link
            component="button"
            type="button"
            onClick={() => onNavigate('/subscription-terms')}
            sx={{ mr: 'auto', color: 'var(--morius-accent)', fontSize: '0.86rem', fontWeight: 700 }}
          >
            Полная версия
          </Link>
          <Button onClick={() => setIsTermsOpen(false)} sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--morius-text-secondary)' }}>
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={isCardsOpen} onClose={() => setIsCardsOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: SHOP_DIALOG_PAPER_SX }} BackdropProps={{ sx: { backgroundColor: 'rgba(1,4,9,0.86)' } }}>
        <DialogTitle>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography component="span" sx={{ color: 'var(--morius-title-text)', fontSize: '1.2rem', fontWeight: 900 }}>
              Способы оплаты
            </Typography>
            <IconButton onClick={() => setIsCardsOpen(false)} sx={{ color: 'var(--morius-text-secondary)' }}>×</IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.6} sx={{ pt: 0.4 }}>
            {justSubscribed ? (
              <Alert severity="success" sx={{ borderRadius: '12px' }} onClose={() => setJustSubscribed(false)}>
                Оплата прошла успешно. Подписка активна, карта привязана для автопродления.
              </Alert>
            ) : null}

            {subscriptions.length > 0 ? (
              <Box>
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.95rem', fontWeight: 900, mb: 0.8 }}>
                  Мои подписки
                </Typography>
                <Stack spacing={1}>
                  {subscriptions.map((subscription) => {
                    const isActive = subscription.status === 'active'
                    const isCanceling = cancelingId === subscription.id
                    return (
                      <Box
                        key={subscription.id}
                        sx={{
                          borderRadius: '14px',
                          border: 'var(--morius-border-width) solid var(--morius-card-border)',
                          backgroundColor: 'var(--morius-elevated-bg)',
                          p: 1.6,
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.4 }}>
                          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.02rem', fontWeight: 900 }}>
                            {subscription.plan_title}
                          </Typography>
                          <Chip
                            label={isActive ? 'Активна' : 'Отменена'}
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.66rem',
                              fontWeight: 800,
                              color: isActive ? '#0c1f17' : 'var(--morius-text-secondary)',
                              backgroundColor: isActive ? '#5ADDC7' : 'var(--morius-card-bg)',
                            }}
                          />
                        </Stack>
                        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.85rem', mt: 0.4 }}>
                          {formatPrice(subscription.price_rub)} / мес
                          {subscription.card_title ? ` • ${subscription.card_title}` : ''}
                        </Typography>
                        <Stack spacing={0.2} sx={{ mt: 0.6 }}>
                          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem' }}>
                            Оформлена: {formatDateRu(subscription.started_at)}
                          </Typography>
                          {isActive ? (
                            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem' }}>
                              Следующее списание: {formatDateRu(subscription.next_charge_at)}
                            </Typography>
                          ) : (
                            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem' }}>
                              Отменена: {formatDateRu(subscription.canceled_at)}
                            </Typography>
                          )}
                        </Stack>
                        {isActive ? (
                          <Button
                            onClick={() => setCancelTarget(subscription)}
                            disabled={isCanceling}
                            sx={{
                              mt: 1,
                              minHeight: 38,
                              px: 1.6,
                              borderRadius: '10px',
                              textTransform: 'none',
                              fontWeight: 800,
                              color: 'var(--morius-text-secondary)',
                              border: 'var(--morius-border-width) solid var(--morius-card-border)',
                              backgroundColor: 'transparent',
                              '&:hover': { backgroundColor: 'var(--morius-card-bg)' },
                            }}
                          >
                            {isCanceling ? 'Отменяем...' : 'Отменить подписку'}
                          </Button>
                        ) : null}
                      </Box>
                    )
                  })}
                </Stack>
                <Divider sx={{ mt: 1.6, borderColor: 'var(--morius-card-border)' }} />
              </Box>
            ) : null}

            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.95rem', fontWeight: 900 }}>
              Привязанные карты
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, mt: -1 }}>
              Здесь хранятся карты, привязанные для автоматического продления подписки. Вы можете в любой момент отвязать карту — после этого автосписания по ней прекращаются.
            </Typography>

            {canManageShop ? (
              <Box sx={{ borderRadius: '12px', border: '1px dashed var(--morius-card-border)', backgroundColor: 'var(--morius-elevated-bg)', p: 1.2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', lineHeight: 1.4 }}>
                    Тестовая карта для подготовки скриншотов для ЮKassa. Никаких реальных списаний.
                  </Typography>
                  <Button
                    onClick={() => void handleCreateDemoCard()}
                    disabled={isCreatingDemoCard}
                    sx={{ flexShrink: 0, minHeight: 38, px: 1.6, borderRadius: '10px', textTransform: 'none', fontWeight: 900, color: 'var(--morius-title-text)', backgroundColor: 'color-mix(in srgb, var(--morius-accent) 20%, var(--morius-card-bg))' }}
                  >
                    {isCreatingDemoCard ? 'Добавляем...' : 'Добавить тестовую карту'}
                  </Button>
                </Stack>
              </Box>
            ) : null}

            {isLoadingMethods && paymentMethods.length === 0 ? (
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>Загружаем карты...</Typography>
            ) : paymentMethods.length === 0 ? (
              <Box sx={{ borderRadius: '14px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-elevated-bg)', p: 2, textAlign: 'center' }}>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', lineHeight: 1.45 }}>
                  Привязанных карт пока нет. Карта появится здесь после оформления подписки.
                </Typography>
              </Box>
            ) : (
              paymentMethods.map((method) => {
                const consent = Boolean(unbindConsent[method.id])
                const isDeleting = deletingMethodId === method.id
                return (
                  <Box
                    key={method.id}
                    sx={{
                      borderRadius: '14px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-card-bg)',
                      p: 1.6,
                    }}
                  >
                    <Stack direction="row" spacing={1.4} alignItems="center">
                      <Box
                        sx={{
                          width: 52,
                          height: 34,
                          borderRadius: '8px',
                          flexShrink: 0,
                          display: 'grid',
                          placeItems: 'center',
                          background: 'linear-gradient(135deg, #2b3242, #161b24)',
                          border: '1px solid var(--morius-card-border)',
                          color: 'var(--morius-title-text)',
                          fontSize: '0.62rem',
                          fontWeight: 900,
                          letterSpacing: '0.04em',
                        }}
                      >
                        {method.card_type || 'КАРТА'}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.4 }}>
                          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 900 }}>
                            {method.title || `•••• ${method.card_last4}`}
                          </Typography>
                          {method.is_default ? (
                            <Chip label="Основная" size="small" sx={{ height: 20, fontSize: '0.66rem', fontWeight: 800, color: 'var(--morius-title-text)', backgroundColor: 'var(--morius-elevated-bg)' }} />
                          ) : null}
                          {method.is_demo ? (
                            <Chip label="Тест" size="small" sx={{ height: 20, fontSize: '0.66rem', fontWeight: 800, color: '#101317', backgroundColor: '#F2B356' }} />
                          ) : null}
                        </Stack>
                        {method.expiry_month && method.expiry_year ? (
                          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem' }}>
                            Действует до {method.expiry_month}/{method.expiry_year.slice(-2)}
                          </Typography>
                        ) : null}
                      </Box>
                    </Stack>
                    <Divider sx={{ my: 1.2, borderColor: 'var(--morius-card-border)' }} />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={consent}
                          onChange={(event) =>
                            setUnbindConsent((previous) => ({ ...previous, [method.id]: event.target.checked }))
                          }
                          sx={{ color: 'var(--morius-text-secondary)', '&.Mui-checked': { color: 'rgba(255,107,107,0.92)' } }}
                        />
                      }
                      label={
                        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem', lineHeight: 1.4 }}>
                          Подтверждаю, что хочу отвязать эту карту и отключить автосписания по ней
                        </Typography>
                      }
                      sx={{ alignItems: 'flex-start', m: 0 }}
                    />
                    <Button
                      onClick={() => setUnbindMethod(method)}
                      disabled={!consent || isDeleting}
                      fullWidth
                      sx={{
                        mt: 1,
                        minHeight: 42,
                        borderRadius: '12px',
                        textTransform: 'none',
                        fontWeight: 900,
                        color: 'rgba(255,194,194,0.96)',
                        border: 'var(--morius-border-width) solid rgba(255,107,107,0.34)',
                        backgroundColor: 'rgba(255,107,107,0.08)',
                        '&.Mui-disabled': { color: 'var(--morius-text-secondary)', borderColor: 'var(--morius-card-border)', backgroundColor: 'transparent' },
                        '&:hover': { backgroundColor: 'rgba(255,107,107,0.14)', borderColor: 'rgba(255,107,107,0.52)' },
                      }}
                    >
                      {isDeleting ? 'Удаляем...' : 'Удалить карту'}
                    </Button>
                  </Box>
                )
              })
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button onClick={() => setIsCardsOpen(false)} sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--morius-text-secondary)' }}>
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(unbindMethod)} onClose={() => (deletingMethodId === null ? setUnbindMethod(null) : undefined)} maxWidth="xs" fullWidth PaperProps={{ sx: SHOP_DIALOG_PAPER_SX }} BackdropProps={{ sx: { backgroundColor: 'rgba(1,4,9,0.86)' } }}>
        <DialogTitle sx={{ color: 'var(--morius-title-text)', fontWeight: 900 }}>
          Отвязать карту?
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'var(--morius-text-secondary)', lineHeight: 1.55 }}>
            Карта «{unbindMethod?.title ?? ''}» будет удалена, а автоматические списания по ней прекратятся. Повторная оплата без вашего согласия станет невозможна.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button
            onClick={() => setUnbindMethod(null)}
            disabled={deletingMethodId !== null}
            sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--morius-text-secondary)' }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => void handleConfirmUnbind()}
            disabled={deletingMethodId !== null}
            sx={{
              borderRadius: '12px',
              textTransform: 'none',
              fontWeight: 900,
              color: 'rgba(255,194,194,0.96)',
              border: 'var(--morius-border-width) solid rgba(255,107,107,0.34)',
              backgroundColor: 'rgba(255,107,107,0.1)',
              '&:hover': { backgroundColor: 'rgba(255,107,107,0.16)', borderColor: 'rgba(255,107,107,0.52)' },
            }}
          >
            {deletingMethodId !== null ? 'Удаляем...' : 'Удалить карту'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(checkoutPlan)} onClose={handleCloseCheckout} maxWidth="xs" fullWidth PaperProps={{ sx: SHOP_DIALOG_PAPER_SX }} BackdropProps={{ sx: { backgroundColor: 'rgba(1,4,9,0.9)' } }}>
        <DialogTitle sx={{ color: 'var(--morius-title-text)', fontWeight: 900 }}>
          Оплата подписки
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.4} sx={{ pt: 0.4 }}>
            <Box sx={{ borderRadius: '12px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-elevated-bg)', p: 1.4 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>
                  {checkoutPlan?.title ?? ''}
                </Typography>
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.1rem', fontWeight: 900 }}>
                  {formatPrice(checkoutPlan?.price_rub ?? 0)} / мес
                </Typography>
              </Stack>
            </Box>
            <TextField
              label="Номер карты"
              value={checkoutNumber}
              onChange={(event) => setCheckoutNumber(formatCardNumberInput(event.target.value))}
              placeholder="0000 0000 0000 0000"
              inputProps={{ inputMode: 'numeric' }}
              fullWidth
            />
            <Stack direction="row" spacing={1}>
              <TextField
                label="ММ/ГГ"
                value={checkoutExpiry}
                onChange={(event) => setCheckoutExpiry(formatCardExpiryInput(event.target.value))}
                placeholder="12/29"
                inputProps={{ inputMode: 'numeric' }}
                sx={{ flex: 1 }}
              />
              <TextField
                label="CVC"
                value={checkoutCvc}
                onChange={(event) => setCheckoutCvc(event.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="123"
                inputProps={{ inputMode: 'numeric' }}
                sx={{ flex: 1 }}
              />
            </Stack>
            <TextField
              label="Имя на карте"
              value={checkoutHolder}
              onChange={(event) => setCheckoutHolder(event.target.value.slice(0, 80))}
              placeholder="IVAN IVANOV"
              fullWidth
            />
            <Alert severity="info" sx={{ borderRadius: '12px' }}>
              Тестовая оплата для подготовки скриншотов. Реальное списание не производится, полный номер карты не сохраняется.
            </Alert>
            {checkoutError ? <Alert severity="error" sx={{ borderRadius: '12px' }}>{checkoutError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button onClick={handleCloseCheckout} disabled={isPaying} sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--morius-text-secondary)' }}>
            Отмена
          </Button>
          <Button
            onClick={() => void handlePayCheckout()}
            disabled={isPaying}
            sx={{
              borderRadius: '12px',
              textTransform: 'none',
              fontWeight: 900,
              color: '#101317',
              backgroundColor: 'var(--morius-accent)',
              '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-accent) 88%, #fff 12%)' },
              '&.Mui-disabled': { color: 'var(--morius-text-secondary)', backgroundColor: 'var(--morius-elevated-bg)' },
            }}
          >
            {isPaying ? 'Оплата...' : `Оплатить ${formatPrice(checkoutPlan?.price_rub ?? 0)}`}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(cancelTarget)} onClose={() => (cancelingId === null ? setCancelTarget(null) : undefined)} maxWidth="xs" fullWidth PaperProps={{ sx: SHOP_DIALOG_PAPER_SX }} BackdropProps={{ sx: { backgroundColor: 'rgba(1,4,9,0.86)' } }}>
        <DialogTitle sx={{ color: 'var(--morius-title-text)', fontWeight: 900 }}>
          Отменить подписку?
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'var(--morius-text-secondary)', lineHeight: 1.55 }}>
            Подписка «{cancelTarget?.plan_title ?? ''}» будет отменена, автопродление прекратится. Доступ сохранится до конца уже оплаченного периода.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.4 }}>
          <Button
            onClick={() => setCancelTarget(null)}
            disabled={cancelingId !== null}
            sx={{ borderRadius: '12px', textTransform: 'none', color: 'var(--morius-text-secondary)' }}
          >
            Не отменять
          </Button>
          <Button
            onClick={() => void handleCancelSubscription()}
            disabled={cancelingId !== null}
            sx={{
              borderRadius: '12px',
              textTransform: 'none',
              fontWeight: 900,
              color: 'rgba(255,194,194,0.96)',
              border: 'var(--morius-border-width) solid rgba(255,107,107,0.34)',
              backgroundColor: 'rgba(255,107,107,0.1)',
              '&:hover': { backgroundColor: 'rgba(255,107,107,0.16)', borderColor: 'rgba(255,107,107,0.52)' },
            }}
          >
            {cancelingId !== null ? 'Отменяем...' : 'Отменить подписку'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default ShopPage
