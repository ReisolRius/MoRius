import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AvatarCropDialog from './AvatarCropDialog'
import BaseDialog from './dialogs/BaseDialog'
import {
  createStoryCharacter,
  deleteStoryCharacter,
  listStoryCharacters,
  updateStoryCharacter,
} from '../services/storyApi'
import type { StoryCharacter } from '../types/story'

type CharacterManagerDialogProps = {
  open: boolean
  authToken: string
  onClose: () => void
  initialMode?: 'list' | 'create'
  initialCharacterId?: number | null
}

type CharacterDraftMode = 'create' | 'edit'

const CHARACTER_AVATAR_MAX_BYTES = 500 * 1024
const CHARACTER_AVATAR_SOURCE_MAX_BYTES = 2 * 1024 * 1024

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Некорректный формат файла'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) {
    return dataUrl.length
  }
  const payload = dataUrl.slice(commaIndex + 1)
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, (payload.length * 3) / 4 - padding)
}

function normalizeCharacterTriggersDraft(value: string, fallbackName: string): string[] {
  const normalizedValues = value
    .split(/[\n,;]+/)
    .map((entry) => entry.replace(/\s+/g, ' ').trim())
    .filter((entry) => entry.length > 0)

  const deduplicated: string[] = []
  const seen = new Set<string>()
  normalizedValues.forEach((entry) => {
    const key = entry.toLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    deduplicated.push(entry)
  })

  if (deduplicated.length === 0) {
    const fallback = fallbackName.replace(/\s+/g, ' ').trim()
    if (fallback) {
      deduplicated.push(fallback)
    }
  }

  return deduplicated.slice(0, 16)
}

type CharacterAvatarProps = {
  avatarUrl: string | null
  avatarScale?: number
  fallbackLabel: string
  size?: number
}

function CharacterAvatar({ avatarUrl, avatarScale = 1, fallbackLabel, size = 44 }: CharacterAvatarProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const firstSymbol = fallbackLabel.trim().charAt(0).toUpperCase() || '•'

  if (avatarUrl && avatarUrl !== failedImageUrl) {
    return (
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
        }}
      >
        <Box
          component="img"
          src={avatarUrl}
          alt={fallbackLabel}
          onError={() => setFailedImageUrl(avatarUrl)}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${Math.max(1, Math.min(3, avatarScale))})`,
            transformOrigin: 'center center',
          }}
        />
      </Box>
    )
  }

  return (
    <Box
      title={fallbackLabel}
      aria-label={fallbackLabel}
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        color: 'rgba(219, 227, 236, 0.92)',
        fontSize: Math.max(14, Math.round(size * 0.38)),
        fontWeight: 700,
      }}
    >
      {firstSymbol}
    </Box>
  )
}

function CharacterManagerDialog({
  open,
  authToken,
  onClose,
  initialMode = 'list',
  initialCharacterId = null,
}: CharacterManagerDialogProps) {
  const [characters, setCharacters] = useState<StoryCharacter[]>([])
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(false)
  const [isSavingCharacter, setIsSavingCharacter] = useState(false)
  const [deletingCharacterId, setDeletingCharacterId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const [draftMode, setDraftMode] = useState<CharacterDraftMode>('create')
  const [editingCharacterId, setEditingCharacterId] = useState<number | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [triggersDraft, setTriggersDraft] = useState('')
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  const [avatarScaleDraft, setAvatarScaleDraft] = useState(1)
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [characterMenuAnchorEl, setCharacterMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [characterMenuCharacterId, setCharacterMenuCharacterId] = useState<number | null>(null)
  const [characterDeleteTarget, setCharacterDeleteTarget] = useState<StoryCharacter | null>(null)
  const [hasAppliedInitialAction, setHasAppliedInitialAction] = useState(false)

  const sortedCharacters = useMemo(
    () =>
      characters
        .filter((item): item is StoryCharacter => Boolean(item) && typeof item.id === 'number')
        .sort((left, right) => left.id - right.id),
    [characters],
  )
  const selectedCharacterMenuItem = useMemo(
    () =>
      characterMenuCharacterId !== null
        ? characters.find((character) => character.id === characterMenuCharacterId) ?? null
        : null,
    [characterMenuCharacterId, characters],
  )

  const resetDraft = useCallback(() => {
    setDraftMode('create')
    setEditingCharacterId(null)
    setNameDraft('')
    setDescriptionDraft('')
    setTriggersDraft('')
    setAvatarDraft(null)
    setAvatarScaleDraft(1)
    setAvatarCropSource(null)
    setAvatarError('')
  }, [])

  const loadCharacters = useCallback(async () => {
    setErrorMessage('')
    setIsLoadingCharacters(true)
    try {
      const loadedCharacters = await listStoryCharacters(authToken)
      const normalizedCharacters = loadedCharacters
        .filter((item): item is StoryCharacter => Boolean(item) && typeof item.id === 'number')
        .map((item) => ({
          ...item,
          name: typeof item.name === 'string' ? item.name : '',
          description: typeof item.description === 'string' ? item.description : '',
          triggers: Array.isArray(item.triggers) ? item.triggers.filter((value): value is string => typeof value === 'string') : [],
          avatar_url: typeof item.avatar_url === 'string' ? item.avatar_url : null,
          avatar_scale: typeof item.avatar_scale === 'number' ? item.avatar_scale : 1,
        }))
      setCharacters(normalizedCharacters)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить персонажей'
      setErrorMessage(detail)
      setCharacters([])
    } finally {
      setIsLoadingCharacters(false)
    }
  }, [authToken])

  useEffect(() => {
    if (!open) {
      setCharacterMenuAnchorEl(null)
      setCharacterMenuCharacterId(null)
      setCharacterDeleteTarget(null)
      setAvatarCropSource(null)
      setHasAppliedInitialAction(false)
      return
    }
    setIsEditorOpen(false)
    setCharacterMenuAnchorEl(null)
    setCharacterMenuCharacterId(null)
    setCharacterDeleteTarget(null)
    setHasAppliedInitialAction(false)
    resetDraft()
    void loadCharacters()
  }, [loadCharacters, open, resetDraft])

  const handleCloseDialog = () => {
    if (isSavingCharacter || deletingCharacterId !== null) {
      return
    }
    setCharacterMenuAnchorEl(null)
    setCharacterMenuCharacterId(null)
    setCharacterDeleteTarget(null)
    setAvatarCropSource(null)
    onClose()
  }

  const handleStartCreate = useCallback(() => {
    if (isSavingCharacter || deletingCharacterId !== null) {
      return
    }
    resetDraft()
    setIsEditorOpen(true)
  }, [deletingCharacterId, isSavingCharacter, resetDraft])

  const handleStartEdit = useCallback((character: StoryCharacter) => {
    if (isSavingCharacter || deletingCharacterId !== null) {
      return
    }
    setDraftMode('edit')
    setEditingCharacterId(character.id)
    setNameDraft(character.name)
    setDescriptionDraft(character.description)
    setTriggersDraft(character.triggers.join(', '))
    setAvatarDraft(character.avatar_url)
    setAvatarScaleDraft(Math.max(1, Math.min(3, character.avatar_scale ?? 1)))
    setAvatarCropSource(null)
    setAvatarError('')
    setIsEditorOpen(true)
  }, [deletingCharacterId, isSavingCharacter])

  const handleCancelEdit = () => {
    if (isSavingCharacter || deletingCharacterId !== null) {
      return
    }
    setIsEditorOpen(false)
    setAvatarCropSource(null)
    resetDraft()
  }

  const handleChooseAvatar = () => {
    if (isSavingCharacter) {
      return
    }
    avatarInputRef.current?.click()
  }

  const handleAvatarChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setAvatarError('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }

    if (selectedFile.size > CHARACTER_AVATAR_SOURCE_MAX_BYTES) {
      setAvatarError('Слишком большой файл. Максимум 2 МБ.')
      return
    }

    setAvatarError('')
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      setAvatarCropSource(dataUrl)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обработать изображение'
      setAvatarError(detail)
    }
  }, [])

  const handleSaveCroppedAvatar = useCallback(
    (croppedDataUrl: string) => {
      if (isSavingCharacter || !croppedDataUrl) {
        return
      }
      if (estimateDataUrlBytes(croppedDataUrl) > CHARACTER_AVATAR_MAX_BYTES) {
        setAvatarError('Avatar is too large after crop. Maximum is 500 KB.')
        return
      }
      setAvatarDraft(croppedDataUrl)
      setAvatarScaleDraft(1)
      setAvatarCropSource(null)
      setAvatarError('')
    },
    [isSavingCharacter],
  )

  const handleSaveCharacter = useCallback(async () => {
    if (isSavingCharacter) {
      return
    }
    const normalizedName = nameDraft.replace(/\s+/g, ' ').trim()
    const normalizedDescription = descriptionDraft.replace(/\r\n/g, '\n').trim()

    if (!normalizedName) {
      setErrorMessage('Имя персонажа не может быть пустым')
      return
    }
    if (!normalizedDescription) {
      setErrorMessage('Описание персонажа не может быть пустым')
      return
    }

    const normalizedTriggers = normalizeCharacterTriggersDraft(triggersDraft, normalizedName)

    setErrorMessage('')
    setIsSavingCharacter(true)
    try {
      if (draftMode === 'create') {
        await createStoryCharacter({
          token: authToken,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            triggers: normalizedTriggers,
            avatar_url: avatarDraft,
            avatar_scale: avatarScaleDraft,
          },
        })
      } else if (editingCharacterId !== null) {
        await updateStoryCharacter({
          token: authToken,
          characterId: editingCharacterId,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            triggers: normalizedTriggers,
            avatar_url: avatarDraft,
            avatar_scale: avatarScaleDraft,
          },
        })
      }
      await loadCharacters()

      setIsEditorOpen(false)
      resetDraft()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить персонажа'
      setErrorMessage(detail)
    } finally {
      setIsSavingCharacter(false)
    }
  }, [authToken, avatarDraft, avatarScaleDraft, descriptionDraft, draftMode, editingCharacterId, isSavingCharacter, loadCharacters, nameDraft, resetDraft, triggersDraft])

  const handleDeleteCharacter = useCallback(
    async (characterId: number) => {
      if (isSavingCharacter || deletingCharacterId !== null) {
        return
      }

      setErrorMessage('')
      setDeletingCharacterId(characterId)
      try {
        await deleteStoryCharacter({
          token: authToken,
          characterId,
        })
        await loadCharacters()
        if (editingCharacterId === characterId) {
          setIsEditorOpen(false)
          resetDraft()
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось удалить персонажа'
        setErrorMessage(detail)
      } finally {
        setDeletingCharacterId(null)
      }
    },
    [authToken, deletingCharacterId, editingCharacterId, isSavingCharacter, loadCharacters, resetDraft],
  )

  const handleOpenCharacterItemMenu = useCallback((event: ReactMouseEvent<HTMLElement>, characterId: number) => {
    event.stopPropagation()
    setCharacterMenuAnchorEl(event.currentTarget)
    setCharacterMenuCharacterId(characterId)
  }, [])

  const handleCloseCharacterItemMenu = useCallback(() => {
    setCharacterMenuAnchorEl(null)
    setCharacterMenuCharacterId(null)
  }, [])

  const handleEditCharacterFromMenu = useCallback(() => {
    if (!selectedCharacterMenuItem) {
      return
    }
    handleStartEdit(selectedCharacterMenuItem)
    handleCloseCharacterItemMenu()
  }, [handleCloseCharacterItemMenu, handleStartEdit, selectedCharacterMenuItem])

  const handleRequestDeleteCharacterFromMenu = useCallback(() => {
    if (!selectedCharacterMenuItem || isSavingCharacter) {
      return
    }
    setCharacterDeleteTarget(selectedCharacterMenuItem)
    handleCloseCharacterItemMenu()
  }, [handleCloseCharacterItemMenu, isSavingCharacter, selectedCharacterMenuItem])

  const handleCancelCharacterDeletion = useCallback(() => {
    if (deletingCharacterId !== null) {
      return
    }
    setCharacterDeleteTarget(null)
  }, [deletingCharacterId])

  const handleConfirmCharacterDeletion = useCallback(async () => {
    if (!characterDeleteTarget) {
      return
    }
    const targetId = characterDeleteTarget.id
    setCharacterDeleteTarget(null)
    await handleDeleteCharacter(targetId)
  }, [characterDeleteTarget, handleDeleteCharacter])

  useEffect(() => {
    if (!open || isLoadingCharacters || hasAppliedInitialAction) {
      return
    }

    if (initialCharacterId !== null) {
      const targetCharacter = sortedCharacters.find((character) => character.id === initialCharacterId) ?? null
      if (targetCharacter) {
        handleStartEdit(targetCharacter)
      }
      setHasAppliedInitialAction(true)
      return
    }

    if (initialMode === 'create') {
      handleStartCreate()
      setHasAppliedInitialAction(true)
      return
    }

    setHasAppliedInitialAction(true)
  }, [
    handleStartCreate,
    handleStartEdit,
    hasAppliedInitialAction,
    initialCharacterId,
    initialMode,
    isLoadingCharacters,
    open,
    sortedCharacters,
  ])

  return (
    <BaseDialog
      open={open}
      onClose={handleCloseDialog}
      maxWidth="sm"
      rawChildren
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '1.4rem' }}>Мои персонажи</Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 0.6 }}>
        <Stack spacing={1.1}>
          {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

          {isEditorOpen ? (
            <Box
              sx={{
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-card-bg)',
                px: 1.1,
                py: 1.1,
              }}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box
                    role="button"
                    tabIndex={0}
                    aria-label="Изменить аватар персонажа"
                    onClick={handleChooseAvatar}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleChooseAvatar()
                      }
                    }}
                    sx={{
                      position: 'relative',
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      cursor: isSavingCharacter ? 'default' : 'pointer',
                      outline: 'none',
                      '&:hover .morius-character-avatar-overlay': {
                        opacity: isSavingCharacter ? 0 : 1,
                      },
                      '&:focus-visible .morius-character-avatar-overlay': {
                        opacity: isSavingCharacter ? 0 : 1,
                      },
                    }}
                  >
                    <CharacterAvatar avatarUrl={avatarDraft} avatarScale={avatarScaleDraft} fallbackLabel={nameDraft || 'Персонаж'} size={64} />
                    <Box
                      className="morius-character-avatar-overlay"
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(23, 23, 22, 0.72)',
                        opacity: 0,
                        transition: 'opacity 180ms ease',
                      }}
                    >
                      <Box
                        sx={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          border: 'var(--morius-border-width) solid rgba(219, 221, 231, 0.5)',
                          backgroundColor: 'var(--morius-elevated-bg)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--morius-text-primary)',
                          fontSize: '1.02rem',
                          fontWeight: 700,
                        }}
                      >
                        ✎
                      </Box>
                    </Box>
                  </Box>
                  <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.82rem' }}>
                    Нажмите на аватар, чтобы заменить изображение
                  </Typography>
                </Stack>
                <Box>
                  <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.82rem' }}>
                    Масштаб аватара: {avatarScaleDraft.toFixed(2)}x
                  </Typography>
                  <Slider
                    min={1}
                    max={3}
                    step={0.05}
                    value={avatarScaleDraft}
                    onChange={(_, value) => setAvatarScaleDraft(value as number)}
                    disabled={isSavingCharacter}
                  />
                </Box>

                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleAvatarChange}
                  style={{ display: 'none' }}
                />

                <TextField
                  label="Имя"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  fullWidth
                  disabled={isSavingCharacter}
                  inputProps={{ maxLength: 120 }}
                />
                <TextField
                  label="Описание"
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  fullWidth
                  multiline
                  minRows={4}
                  maxRows={8}
                  disabled={isSavingCharacter}
                  inputProps={{ maxLength: 6000 }}
                />
                <TextField
                  label="Триггеры"
                  value={triggersDraft}
                  onChange={(event) => setTriggersDraft(event.target.value)}
                  fullWidth
                  multiline
                  minRows={2}
                  maxRows={5}
                  disabled={isSavingCharacter}
                  placeholder="через запятую"
                />
                {avatarError ? <Alert severity="error">{avatarError}</Alert> : null}
                <Stack direction="row" justifyContent="flex-end" spacing={0.8}>
                  <Button onClick={handleCancelEdit} disabled={isSavingCharacter} sx={{ color: 'text.secondary' }}>
                    Отмена
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => void handleSaveCharacter()}
                    disabled={isSavingCharacter}
                    sx={{
                      minHeight: 38,
                      borderRadius: 'var(--morius-radius)',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-button-active)',
                      color: 'var(--morius-text-primary)',
                      textTransform: 'none',
                      '&:hover': {
                        backgroundColor: 'var(--morius-button-hover)',
                      },
                    }}
                  >
                    {isSavingCharacter ? (
                      <CircularProgress size={16} sx={{ color: 'var(--morius-text-primary)' }} />
                    ) : draftMode === 'create' ? (
                      'Создать'
                    ) : (
                      'Сохранить'
                    )}
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ) : (
            <Button
              onClick={handleStartCreate}
              disabled={isSavingCharacter || deletingCharacterId !== null}
              sx={{
                minHeight: 40,
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                color: 'var(--morius-text-primary)',
                textTransform: 'none',
                alignSelf: 'flex-start',
              }}
            >
              Создать персонажа
            </Button>
          )}

          {isLoadingCharacters && sortedCharacters.length === 0 ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 4.2 }}>
              <CircularProgress size={24} />
            </Stack>
          ) : (
            <Box className="morius-scrollbar" sx={{ maxHeight: 350, overflowY: 'auto', pr: 0.2 }}>
              <Stack spacing={0.75}>
                {sortedCharacters.map((character) => (
                  <Box
                    key={character.id}
                    sx={{
                      borderRadius: '12px',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-card-bg)',
                      px: 0.95,
                      py: 0.72,
                    }}
                  >
                    <Stack spacing={0.45}>
                      <Stack direction="row" spacing={0.8} alignItems="center">
                        <CharacterAvatar avatarUrl={character.avatar_url} avatarScale={character.avatar_scale} fallbackLabel={character.name} size={34} />
                        <Stack sx={{ minWidth: 0, flex: 1 }} spacing={0.08}>
                          <Typography
                            sx={{
                              color: 'var(--morius-title-text)',
                              fontWeight: 700,
                              fontSize: '0.9rem',
                              lineHeight: 1.2,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {character.name}
                          </Typography>
                          {character.triggers.length > 0 ? (
                            <Typography
                              sx={{
                                color: 'var(--morius-text-secondary)',
                                fontSize: '0.76rem',
                                lineHeight: 1.2,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Триггеры: {character.triggers.join(', ')}
                            </Typography>
                          ) : null}
                        </Stack>
                        <IconButton
                          onClick={(event) => handleOpenCharacterItemMenu(event, character.id)}
                          disabled={isSavingCharacter || deletingCharacterId === character.id}
                          sx={{
                            width: 28,
                            height: 28,
                            color: 'var(--morius-text-secondary)',
                            flexShrink: 0,
                            backgroundColor: 'transparent !important',
                            border: 'none',
                            '&:hover': {
                              backgroundColor: 'transparent !important',
                            },
                            '&:active': { backgroundColor: 'transparent !important' },
                            '&.Mui-focusVisible': { backgroundColor: 'transparent !important' },
                          }}
                        >
                          {deletingCharacterId === character.id ? (
                            <CircularProgress size={14} sx={{ color: 'var(--morius-text-secondary)' }} />
                          ) : (
                            <Box sx={{ fontSize: '1rem', lineHeight: 1 }}>...</Box>
                          )}
                        </IconButton>
                      </Stack>
                      <Typography
                        sx={{
                          color: 'var(--morius-text-secondary)',
                          fontSize: '0.82rem',
                          lineHeight: 1.3,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {character.description}
                      </Typography>
                    </Stack>
                  </Box>
                ))}
                {sortedCharacters.length === 0 ? (
                  <Typography sx={{ color: 'rgba(186, 202, 214, 0.68)', fontSize: '0.9rem' }}>
                    Персонажей пока нет. Создайте первого.
                  </Typography>
                ) : null}
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>

      <Menu
        anchorEl={characterMenuAnchorEl}
        open={Boolean(characterMenuAnchorEl && selectedCharacterMenuItem)}
        onClose={handleCloseCharacterItemMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            mt: 0.5,
            borderRadius: '12px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-card-bg)',
            minWidth: 178,
          },
        }}
      >
        <MenuItem
          onClick={handleEditCharacterFromMenu}
          disabled={
            !selectedCharacterMenuItem ||
            isSavingCharacter ||
            (selectedCharacterMenuItem !== null && deletingCharacterId === selectedCharacterMenuItem.id)
          }
          sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center">
            <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>✎</Box>
            <Box component="span">Изменить</Box>
          </Stack>
        </MenuItem>
        <MenuItem
          onClick={handleRequestDeleteCharacterFromMenu}
          disabled={
            !selectedCharacterMenuItem ||
            isSavingCharacter ||
            (selectedCharacterMenuItem !== null && deletingCharacterId === selectedCharacterMenuItem.id)
          }
          sx={{ color: 'rgba(248, 176, 176, 0.94)', fontSize: '0.9rem' }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center">
            <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>⌦</Box>
            <Box component="span">Удалить</Box>
          </Stack>
        </MenuItem>
      </Menu>

      <BaseDialog
        open={Boolean(characterDeleteTarget)}
        onClose={handleCancelCharacterDeletion}
        maxWidth="xs"
        rawChildren
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Удалить персонажа?</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'text.secondary' }}>
            {characterDeleteTarget
              ? `Персонаж «${characterDeleteTarget.name}» будет удален из «Мои персонажи». Это действие нельзя отменить.`
              : 'Это действие нельзя отменить.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={handleCancelCharacterDeletion} disabled={deletingCharacterId !== null} sx={{ color: 'text.secondary' }}>
            Отмена
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleConfirmCharacterDeletion()}
            disabled={deletingCharacterId !== null}
            sx={{
              border: 'var(--morius-border-width) solid rgba(228, 120, 120, 0.44)',
              backgroundColor: 'rgba(184, 78, 78, 0.3)',
              color: 'rgba(251, 190, 190, 0.94)',
              '&:hover': { backgroundColor: 'rgba(196, 88, 88, 0.4)' },
            }}
          >
            {deletingCharacterId !== null ? (
              <CircularProgress size={16} sx={{ color: 'rgba(251, 190, 190, 0.94)' }} />
            ) : (
              'Удалить'
            )}
          </Button>
        </DialogActions>
      </BaseDialog>

      <AvatarCropDialog
        open={Boolean(avatarCropSource)}
        imageSrc={avatarCropSource}
        isSaving={isSavingCharacter}
        outputSize={384}
        onCancel={() => {
          if (!isSavingCharacter) {
            setAvatarCropSource(null)
          }
        }}
        onSave={handleSaveCroppedAvatar}
      />

      <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
        <Button onClick={handleCloseDialog} disabled={isSavingCharacter || deletingCharacterId !== null} sx={{ color: 'text.secondary' }}>
          Закрыть
        </Button>
      </DialogActions>
    </BaseDialog>
  )
}

export default CharacterManagerDialog


