import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
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
}

type CharacterDraftMode = 'create' | 'edit'

const CHARACTER_AVATAR_MAX_BYTES = 2 * 1024 * 1024

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
  fallbackLabel: string
  size?: number
}

function CharacterAvatar({ avatarUrl, fallbackLabel, size = 44 }: CharacterAvatarProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const firstSymbol = fallbackLabel.trim().charAt(0).toUpperCase() || '•'

  if (avatarUrl && avatarUrl !== failedImageUrl) {
    return (
      <Box
        component="img"
        src={avatarUrl}
        alt={fallbackLabel}
        onError={() => setFailedImageUrl(avatarUrl)}
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: '1px solid rgba(186, 202, 214, 0.28)',
          objectFit: 'cover',
          backgroundColor: 'rgba(18, 22, 29, 0.7)',
        }}
      />
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
        border: '1px solid rgba(186, 202, 214, 0.28)',
        background: 'linear-gradient(180deg, rgba(40, 49, 62, 0.86), rgba(20, 24, 31, 0.95))',
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

function CharacterManagerDialog({ open, authToken, onClose }: CharacterManagerDialogProps) {
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
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  const sortedCharacters = useMemo(
    () => [...characters].sort((left, right) => left.id - right.id),
    [characters],
  )

  const resetDraft = useCallback(() => {
    setDraftMode('create')
    setEditingCharacterId(null)
    setNameDraft('')
    setDescriptionDraft('')
    setTriggersDraft('')
    setAvatarDraft(null)
    setAvatarError('')
  }, [])

  const loadCharacters = useCallback(async () => {
    setErrorMessage('')
    setIsLoadingCharacters(true)
    try {
      const loadedCharacters = await listStoryCharacters(authToken)
      setCharacters(loadedCharacters)
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
      return
    }
    setIsEditorOpen(false)
    resetDraft()
    void loadCharacters()
  }, [loadCharacters, open, resetDraft])

  const handleCloseDialog = () => {
    if (isSavingCharacter || deletingCharacterId !== null) {
      return
    }
    onClose()
  }

  const handleStartCreate = () => {
    if (isSavingCharacter || deletingCharacterId !== null) {
      return
    }
    resetDraft()
    setIsEditorOpen(true)
  }

  const handleStartEdit = (character: StoryCharacter) => {
    if (isSavingCharacter || deletingCharacterId !== null) {
      return
    }
    setDraftMode('edit')
    setEditingCharacterId(character.id)
    setNameDraft(character.name)
    setDescriptionDraft(character.description)
    setTriggersDraft(character.triggers.join(', '))
    setAvatarDraft(character.avatar_url)
    setAvatarError('')
    setIsEditorOpen(true)
  }

  const handleCancelEdit = () => {
    if (isSavingCharacter || deletingCharacterId !== null) {
      return
    }
    setIsEditorOpen(false)
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

    if (selectedFile.size > CHARACTER_AVATAR_MAX_BYTES) {
      setAvatarError('Слишком большой файл. Максимум 2 МБ.')
      return
    }

    setAvatarError('')
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      setAvatarDraft(dataUrl)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось обработать изображение'
      setAvatarError(detail)
    }
  }, [])

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
        const createdCharacter = await createStoryCharacter({
          token: authToken,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            triggers: normalizedTriggers,
            avatar_url: avatarDraft,
          },
        })
        setCharacters((previous) => [...previous, createdCharacter])
      } else if (editingCharacterId !== null) {
        const updatedCharacter = await updateStoryCharacter({
          token: authToken,
          characterId: editingCharacterId,
          input: {
            name: normalizedName,
            description: normalizedDescription,
            triggers: normalizedTriggers,
            avatar_url: avatarDraft,
          },
        })
        setCharacters((previous) =>
          previous.map((character) => (character.id === updatedCharacter.id ? updatedCharacter : character)),
        )
      }

      setIsEditorOpen(false)
      resetDraft()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить персонажа'
      setErrorMessage(detail)
    } finally {
      setIsSavingCharacter(false)
    }
  }, [authToken, avatarDraft, descriptionDraft, draftMode, editingCharacterId, isSavingCharacter, nameDraft, resetDraft, triggersDraft])

  const handleDeleteCharacter = useCallback(
    async (character: StoryCharacter) => {
      if (isSavingCharacter || deletingCharacterId !== null) {
        return
      }

      const shouldDelete = window.confirm(`Удалить персонажа «${character.name}»?`)
      if (!shouldDelete) {
        return
      }

      setErrorMessage('')
      setDeletingCharacterId(character.id)
      try {
        await deleteStoryCharacter({
          token: authToken,
          characterId: character.id,
        })
        setCharacters((previous) => previous.filter((item) => item.id !== character.id))
        if (editingCharacterId === character.id) {
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
    [authToken, deletingCharacterId, editingCharacterId, isSavingCharacter, resetDraft],
  )

  return (
    <Dialog
      open={open}
      onClose={handleCloseDialog}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '18px',
          border: '1px solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
        },
      }}
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
                border: '1px solid var(--morius-card-border)',
                backgroundColor: 'rgba(12, 17, 25, 0.7)',
                px: 1.1,
                py: 1.1,
              }}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <CharacterAvatar avatarUrl={avatarDraft} fallbackLabel={nameDraft || 'Персонаж'} size={54} />
                  <Stack direction="row" spacing={0.9}>
                    <Button
                      onClick={handleChooseAvatar}
                      disabled={isSavingCharacter}
                      sx={{
                        minHeight: 36,
                        borderRadius: '10px',
                        border: '1px solid var(--morius-card-border)',
                        color: 'var(--morius-text-primary)',
                        textTransform: 'none',
                      }}
                    >
                      Выбрать аватар
                    </Button>
                    <Button
                      onClick={() => setAvatarDraft(null)}
                      disabled={isSavingCharacter || !avatarDraft}
                      sx={{
                        minHeight: 36,
                        borderRadius: '10px',
                        border: '1px solid var(--morius-card-border)',
                        color: 'var(--morius-text-secondary)',
                        textTransform: 'none',
                      }}
                    >
                      Удалить
                    </Button>
                  </Stack>
                </Stack>

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
                  inputProps={{ maxLength: 1000 }}
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
                      borderRadius: '10px',
                      border: '1px solid var(--morius-card-border)',
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
                border: '1px solid var(--morius-card-border)',
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
                      border: '1px solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-card-bg)',
                      px: 1,
                      py: 0.9,
                    }}
                  >
                    <Stack spacing={0.6}>
                      <Stack direction="row" spacing={0.9} alignItems="center">
                        <CharacterAvatar avatarUrl={character.avatar_url} fallbackLabel={character.name} size={38} />
                        <Stack sx={{ minWidth: 0, flex: 1 }} spacing={0.05}>
                          <Typography sx={{ color: '#e2e8f3', fontWeight: 700, fontSize: '0.94rem' }}>
                            {character.name}
                          </Typography>
                          <Typography sx={{ color: 'rgba(190, 205, 224, 0.74)', fontSize: '0.8rem' }}>
                            Триггеры: {character.triggers.join(', ')}
                          </Typography>
                        </Stack>
                        <Stack direction="row" spacing={0.6}>
                          <Button
                            onClick={() => handleStartEdit(character)}
                            disabled={isSavingCharacter || deletingCharacterId === character.id}
                            sx={{
                              minHeight: 30,
                              minWidth: 78,
                              borderRadius: '9px',
                              border: '1px solid var(--morius-card-border)',
                              color: 'var(--morius-text-primary)',
                              textTransform: 'none',
                              fontSize: '0.8rem',
                              px: 1,
                            }}
                          >
                            Изменить
                          </Button>
                          <Button
                            onClick={() => void handleDeleteCharacter(character)}
                            disabled={isSavingCharacter || deletingCharacterId === character.id}
                            sx={{
                              minHeight: 30,
                              minWidth: 78,
                              borderRadius: '9px',
                              border: '1px solid rgba(228, 120, 120, 0.44)',
                              color: 'rgba(251, 190, 190, 0.92)',
                              textTransform: 'none',
                              fontSize: '0.8rem',
                              px: 1,
                            }}
                          >
                            {deletingCharacterId === character.id ? (
                              <CircularProgress size={14} sx={{ color: 'rgba(251, 190, 190, 0.92)' }} />
                            ) : (
                              'Удалить'
                            )}
                          </Button>
                        </Stack>
                      </Stack>
                      <Typography sx={{ color: 'rgba(207, 217, 232, 0.9)', fontSize: '0.86rem', lineHeight: 1.35 }}>
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
      <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.6 }}>
        <Button onClick={handleCloseDialog} disabled={isSavingCharacter || deletingCharacterId !== null} sx={{ color: 'text.secondary' }}>
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default CharacterManagerDialog
