import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Stack,
  SvgIcon,
  Switch,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  normalizeProfileShowcase,
  updateCurrentUserProfile,
  type ProfileShowcaseItem,
  type ProfileShowcaseKind,
} from '../../services/authApi'
import type { AuthUser } from '../../types/auth'
import type { StoryCommunityCharacterSummary, StoryCommunityWorldSummary } from '../../types/story'
import { getDisplayedTagLabel } from '../../types/auth'
import { resolveApiResourceUrl } from '../../services/httpClient'
import { getProfileBannerPreset } from '../../constants/profileBanners'
import { resolveProfileBannerImageUrl } from '../../utils/cosmeticImageFallbacks'
import ProgressiveImage from '../media/ProgressiveImage'
import UserAvatar from './UserAvatar'

type ProfileShowcaseDialogProps = {
  open: boolean
  user: AuthUser
  authToken: string
  showcase: ProfileShowcaseItem[]
  games: StoryCommunityWorldSummary[]
  characters: StoryCommunityCharacterSummary[]
  onClose: () => void
  onSaved: (user: AuthUser) => void
}

type ShowcaseOption = {
  kind: ProfileShowcaseKind
  title: string
  description: string
}

const SHOWCASE_OPTIONS: readonly ShowcaseOption[] = [
  { kind: 'banner', title: 'Баннер', description: 'Текущий баннер профиля' },
  { kind: 'game', title: 'Игра', description: 'Один из опубликованных миров' },
  { kind: 'character', title: 'Персонаж', description: 'Один из опубликованных персонажей' },
  { kind: 'avatar_frame', title: 'Рамка аватара', description: 'Активная рамка и аватар' },
  { kind: 'badge', title: 'Значок', description: 'Роль или персональный знак' },
]

const sectionLabelSx = {
  color: 'var(--morius-quiet-text)',
  fontSize: '0.66rem',
  fontWeight: 800,
  letterSpacing: '0.13em !important',
  textTransform: 'uppercase',
} as const

function ProfileShowcaseDialog({
  open,
  user,
  authToken,
  showcase,
  games,
  characters,
  onClose,
  onSaved,
}: ProfileShowcaseDialogProps) {
  const isMobile = useMediaQuery('(max-width:700px)')
  const normalizedShowcase = useMemo(() => normalizeProfileShowcase(showcase), [showcase])
  const [draft, setDraft] = useState<ProfileShowcaseItem[]>(normalizedShowcase)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setDraft(normalizedShowcase)
    setError('')
  }, [normalizedShowcase, open])

  const selectedKinds = useMemo(() => new Set(draft.map((item) => item.kind)), [draft])
  const selectedGame = games.find((item) => item.id === draft.find((entry) => entry.kind === 'game')?.entity_id)
  const selectedCharacter = characters.find((item) => item.id === draft.find((entry) => entry.kind === 'character')?.entity_id)
  const bannerPreset = getProfileBannerPreset(user.profile_banner_id)
  const bannerSrc = resolveProfileBannerImageUrl(user.profile_banner_id, user.profile_banner_image_url ?? null) ?? bannerPreset.src
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(normalizedShowcase)

  const toggleKind = (kind: ProfileShowcaseKind, enabled: boolean) => {
    setError('')
    if (!enabled) {
      if (draft.length === 1) {
        setError('Оставьте в витрине хотя бы один элемент.')
        return
      }
      setDraft((previous) => previous.filter((item) => item.kind !== kind))
      return
    }
    if (kind === 'game' && games.length === 0) {
      setError('Сначала опубликуйте игру — после этого её можно будет добавить в витрину.')
      return
    }
    if (kind === 'character' && characters.length === 0) {
      setError('Сначала опубликуйте персонажа — после этого его можно будет добавить в витрину.')
      return
    }
    const entityId = kind === 'game' ? games[0]?.id ?? null : kind === 'character' ? characters[0]?.id ?? null : null
    setDraft((previous) => [...previous, { kind, entity_id: entityId }])
  }

  const selectEntity = (kind: 'game' | 'character', entityId: number) => {
    setDraft((previous) => previous.map((item) => (item.kind === kind ? { ...item, entity_id: entityId } : item)))
  }

  const handleSave = async () => {
    if (!hasChanges || isSaving) return
    setError('')
    setIsSaving(true)
    try {
      const updatedUser = await updateCurrentUserProfile({ token: authToken, profile_showcase: draft })
      onSaved(updatedUser)
      onClose()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось сохранить витрину')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={isSaving ? undefined : onClose}
      fullScreen={isMobile}
      fullWidth
      maxWidth="md"
      BackdropProps={{ sx: { backgroundColor: 'var(--morius-backdrop)', backdropFilter: 'blur(10px)' } }}
      PaperProps={{
        sx: {
          maxHeight: { xs: '100%', sm: '88vh' },
          overflow: 'hidden',
          borderRadius: { xs: 0, sm: '22px !important' },
          border: { xs: 'none !important', sm: 'var(--morius-border-width) solid var(--morius-card-border) !important' },
          background: 'var(--morius-dialog-gradient) !important',
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: { xs: 2, sm: 2.75 }, py: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography component="span" sx={{ display: 'block', color: 'var(--morius-title-text)', fontFamily: 'var(--morius-font-heading)', fontSize: '1.3rem', fontWeight: 700 }}>
            Настройка витрины
          </Typography>
          <Typography sx={{ mt: 0.25, color: 'var(--morius-text-secondary)', fontSize: '0.78rem' }}>
            Выберите, что увидят посетители профиля.
          </Typography>
        </Box>
        <IconButton aria-label="Закрыть" onClick={onClose} disabled={isSaving} sx={{ width: 34, height: 34, color: 'var(--morius-text-secondary)', backgroundColor: 'rgba(255,255,255,0.05) !important' }}>
          <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
            <path d="M6.7 6.7a1 1 0 0 1 1.4 0L12 10.6l3.9-3.9a1 1 0 1 1 1.4 1.4L13.4 12l3.9 3.9a1 1 0 0 1-1.4 1.4L12 13.4l-3.9 3.9a1 1 0 0 1-1.4-1.4l3.9-3.9-3.9-3.9a1 1 0 0 1 0-1.4" fill="currentColor" />
          </SvgIcon>
        </IconButton>
      </DialogTitle>

      <DialogContent dividers className="morius-scrollbar" sx={{ px: { xs: 2, sm: 2.75 }, py: 2.25, borderColor: 'var(--morius-divider-color)' }}>
        {error ? <Alert severity="warning" sx={{ mb: 1.5 }}>{error}</Alert> : null}
        <Typography sx={{ ...sectionLabelSx, mb: 1 }}>Предпросмотр состава</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(126px, 1fr))', gap: 1, mb: 2.5 }}>
          {draft.map((item) => {
            const option = SHOWCASE_OPTIONS.find((entry) => entry.kind === item.kind)
            const title = item.kind === 'game'
              ? selectedGame?.title ?? option?.title
              : item.kind === 'character'
                ? selectedCharacter?.name ?? option?.title
                : item.kind === 'badge'
                  ? getDisplayedTagLabel(user.role, user.profile_tag)
                  : option?.title
            const imageUrl = item.kind === 'banner'
              ? bannerSrc
              : item.kind === 'game'
                ? resolveApiResourceUrl(selectedGame?.cover_image_url)
                : item.kind === 'character'
                  ? resolveApiResourceUrl(selectedCharacter?.avatar_url)
                  : null
            return (
              <Box key={item.kind} sx={{ position: 'relative', minHeight: 96, overflow: 'hidden', borderRadius: '14px', border: 'var(--morius-border-width) solid var(--morius-card-border)', backgroundColor: 'var(--morius-elevated-bg)', p: 1.25 }}>
                {imageUrl ? <ProgressiveImage src={imageUrl} alt="" objectFit="cover" containerSx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} /> : null}
                {item.kind === 'avatar_frame' ? <UserAvatar user={user} size={48} /> : null}
                <Box aria-hidden sx={{ position: 'absolute', inset: 0, background: imageUrl ? 'linear-gradient(180deg, rgba(15,18,24,0.08), rgba(15,18,24,0.92))' : 'none' }} />
                <Stack spacing={0.15} sx={{ position: 'absolute', zIndex: 1, left: 12, right: 12, bottom: 10 }}>
                  <Typography sx={{ color: 'rgba(255,255,255,0.62)', fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase' }}>{option?.title}</Typography>
                  <Typography noWrap sx={{ color: '#fff', fontSize: '0.78rem', fontWeight: 750 }}>{title}</Typography>
                </Stack>
              </Box>
            )
          })}
        </Box>

        <Typography sx={{ ...sectionLabelSx, mb: 1 }}>Элементы витрины</Typography>
        <Stack spacing={1}>
          {SHOWCASE_OPTIONS.map((option) => {
            const selected = selectedKinds.has(option.kind)
            return (
              <Box
                key={option.kind}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr auto', sm: 'minmax(0, 1fr) minmax(210px, 0.8fr) auto' },
                  alignItems: 'center',
                  gap: 1.2,
                  minHeight: 68,
                  px: 1.5,
                  py: 1.1,
                  borderRadius: '14px',
                  border: 'var(--morius-border-width) solid',
                  borderColor: selected ? 'color-mix(in srgb, var(--morius-accent) 48%, var(--morius-card-border))' : 'var(--morius-card-border)',
                  backgroundColor: selected ? 'color-mix(in srgb, var(--morius-accent) 10%, var(--morius-elevated-bg))' : 'var(--morius-elevated-bg)',
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.9rem', fontWeight: 750 }}>{option.title}</Typography>
                  <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem' }}>{option.description}</Typography>
                </Box>
                {selected && option.kind === 'game' ? (
                  <FormControl size="small" sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
                    <Select value={selectedGame?.id ?? ''} onChange={(event) => selectEntity('game', Number(event.target.value))} sx={{ borderRadius: '10px', backgroundColor: 'var(--morius-card-bg)' }}>
                      {games.map((game) => <MenuItem key={game.id} value={game.id}>{game.title}</MenuItem>)}
                    </Select>
                  </FormControl>
                ) : selected && option.kind === 'character' ? (
                  <FormControl size="small" sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
                    <Select value={selectedCharacter?.id ?? ''} onChange={(event) => selectEntity('character', Number(event.target.value))} sx={{ borderRadius: '10px', backgroundColor: 'var(--morius-card-bg)' }}>
                      {characters.map((character) => <MenuItem key={character.id} value={character.id}>{character.name}</MenuItem>)}
                    </Select>
                  </FormControl>
                ) : <Box sx={{ display: { xs: 'none', sm: 'block' } }} />}
                <Switch
                  checked={selected}
                  onChange={(event) => toggleKind(option.kind, event.target.checked)}
                  inputProps={{ 'aria-label': `${selected ? 'Скрыть' : 'Показать'}: ${option.title}` }}
                  sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: 'var(--morius-accent)' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: 'var(--morius-accent)', opacity: 0.88 } }}
                />
              </Box>
            )
          })}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ gap: 1, px: { xs: 2, sm: 2.75 }, py: 1.5, backgroundColor: 'rgba(0,0,0,0.14)' }}>
        <Typography sx={{ display: { xs: 'none', sm: 'block' }, mr: 'auto', color: 'var(--morius-text-secondary)', fontSize: '0.76rem' }}>Порядок элементов соответствует списку</Typography>
        <Button onClick={onClose} disabled={isSaving} sx={{ minHeight: 38, px: 2, color: 'var(--morius-text-secondary)', textTransform: 'none' }}>Отмена</Button>
        <Button onClick={() => void handleSave()} disabled={!hasChanges || isSaving} sx={{ minHeight: 38, px: 2.2, color: '#fff', textTransform: 'none', background: 'var(--morius-accent-gradient) !important', '&.Mui-disabled': { color: 'rgba(255,255,255,0.5)', opacity: 0.58 } }}>
          {isSaving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ProfileShowcaseDialog
