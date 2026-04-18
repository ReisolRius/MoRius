import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import BaseDialog from '../dialogs/BaseDialog'
import ImageCropper from '../ImageCropper'
import TextLimitIndicator from '../TextLimitIndicator'
import WorldCardBannerPreview from './WorldCardBannerPreview'
import {
  createStoryWorldCardTemplate,
  createStoryWorldDetailType,
  listStoryWorldCardTemplates,
  listStoryWorldDetailTypes,
} from '../../services/storyApi'
import type { StoryWorldCardTemplate, StoryWorldCardTemplateKind, StoryWorldDetailType } from '../../types/story'
import {
  buildStoryWorldDetailTypeSuggestions,
  getStoryWorldTemplateEyebrow,
  normalizeStoryWorldDetailTypeValue,
  parseStoryWorldTriggers,
  STORY_WORLD_BANNER_ASPECT,
} from '../../utils/storyWorldCards'
import { prepareAvatarPayloadForRequest, readFileAsDataUrl } from '../../utils/avatar'

const TEMPLATE_TITLE_MAX_LENGTH = 120
const TEMPLATE_CONTENT_MAX_LENGTH = 8000
const TEMPLATE_TRIGGER_INPUT_MAX_LENGTH = 600
const DETAIL_TYPE_MAX_LENGTH = 120
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const filterWorldDetailTypeOptions = createFilterOptions<WorldDetailTypeOption>()

type WorldDetailTypeOption = {
  label: string
  value: string
  isCreateAction?: boolean
}

type WorldCardTemplatePickerDialogProps = {
  open: boolean
  authToken: string
  kind: StoryWorldCardTemplateKind
  title: string
  emptyTitle: string
  emptyDescription: string
  onClose: () => void
  onSelectTemplate: (template: StoryWorldCardTemplate) => void
}

function formatMemoryLabel(memoryTurns: number | null): string {
  if (memoryTurns === null) {
    return 'Всегда'
  }
  if (memoryTurns <= 0) {
    return 'Выкл.'
  }
  return `${memoryTurns} ход.`
}

function WorldCardTemplatePickerDialog({
  open,
  authToken,
  kind,
  title,
  emptyTitle,
  emptyDescription,
  onClose,
  onSelectTemplate,
}: WorldCardTemplatePickerDialogProps) {
  const [templates, setTemplates] = useState<StoryWorldCardTemplate[]>([])
  const [detailTypes, setDetailTypes] = useState<StoryWorldDetailType[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [editorOpen, setEditorOpen] = useState(false)
  const [detailTypeDraft, setDetailTypeDraft] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  const [triggersDraft, setTriggersDraft] = useState('')
  const [memoryTurnsDraft, setMemoryTurnsDraft] = useState<number | null>(kind === 'world' ? 5 : null)
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  const [avatarOriginalDraft, setAvatarOriginalDraft] = useState<string | null>(null)
  const [avatarScaleDraft, setAvatarScaleDraft] = useState(1)
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingDetailType, setIsSavingDetailType] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    let active = true
    setIsLoading(true)
    setError('')

    void Promise.all([
      listStoryWorldCardTemplates({ token: authToken }),
      kind === 'world' ? listStoryWorldDetailTypes({ token: authToken }) : Promise.resolve([] as StoryWorldDetailType[]),
    ])
      .then(([items, loadedDetailTypes]) => {
        if (!active) {
          return
        }
        setTemplates(items)
        setDetailTypes(loadedDetailTypes)
      })
      .catch((requestError) => {
        if (!active) {
          return
        }
        setTemplates([])
        setDetailTypes([])
        setError(requestError instanceof Error ? requestError.message : 'Не удалось загрузить шаблоны карточек мира')
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [authToken, kind, open])

  useEffect(() => {
    if (!open) {
      setSearchQuery('')
    }
  }, [open])

  useEffect(() => {
    if (!editorOpen) {
      setDetailTypeDraft('')
      setTitleDraft('')
      setContentDraft('')
      setTriggersDraft('')
      setMemoryTurnsDraft(kind === 'world' ? 5 : null)
      setAvatarDraft(null)
      setAvatarOriginalDraft(null)
      setAvatarScaleDraft(1)
      setAvatarCropSource(null)
      setIsSaving(false)
      setIsSavingDetailType(false)
    }
  }, [editorOpen, kind])

  const normalizedSearchQuery = useMemo(() => searchQuery.replace(/\s+/g, ' ').trim().toLocaleLowerCase(), [searchQuery])

  const filteredTemplates = useMemo(
    () =>
      templates
        .filter((item) => item.kind === kind)
        .filter((item) =>
          !normalizedSearchQuery
            ? true
            : [item.title, item.content, item.detail_type, item.triggers.join(' ')]
                .join(' ')
                .toLocaleLowerCase()
                .includes(normalizedSearchQuery),
        )
        .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at) || right.id - left.id),
    [kind, normalizedSearchQuery, templates],
  )

  const detailTypeOptions = useMemo<WorldDetailTypeOption[]>(
    () => buildStoryWorldDetailTypeSuggestions(detailTypes, [detailTypeDraft]).map((label) => ({ label, value: label })),
    [detailTypeDraft, detailTypes],
  )

  const normalizedDetailTypeDraft = useMemo(() => normalizeStoryWorldDetailTypeValue(detailTypeDraft), [detailTypeDraft])

  const selectedDetailTypeOption = useMemo(() => {
    if (!normalizedDetailTypeDraft) {
      return null
    }
    return (
      detailTypeOptions.find((option) => option.value.toLocaleLowerCase() === normalizedDetailTypeDraft.toLocaleLowerCase()) ?? {
        label: normalizedDetailTypeDraft,
        value: normalizedDetailTypeDraft,
      }
    )
  }, [detailTypeOptions, normalizedDetailTypeDraft])

  const openCreateEditor = useCallback(() => {
    setError('')
    setEditorOpen(true)
  }, [])

  const handlePickBannerFile = useCallback(() => {
    if (isSaving) {
      return
    }
    avatarInputRef.current?.click()
  }, [isSaving])

  const handleOpenBannerEditor = useCallback(() => {
    if (isSaving) {
      return
    }
    const cropSource = avatarOriginalDraft ?? avatarDraft
    if (cropSource) {
      setAvatarCropSource(cropSource)
      return
    }
    avatarInputRef.current?.click()
  }, [avatarDraft, avatarOriginalDraft, isSaving])

  const handleBannerChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setError('Выберите файл изображения (PNG, JPEG, WEBP или GIF).')
      return
    }
    if (selectedFile.size > AVATAR_MAX_BYTES) {
      setError('Файл слишком большой. Максимум 2 МБ.')
      return
    }

    setError('')
    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      setAvatarCropSource(dataUrl)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось обработать изображение карточки мира')
    }
  }, [])

  const handleSaveCroppedBanner = useCallback((croppedDataUrl: string) => {
    if (!croppedDataUrl) {
      return
    }
    setAvatarDraft(croppedDataUrl)
    setAvatarOriginalDraft(croppedDataUrl)
    setAvatarScaleDraft(1)
    setAvatarCropSource(null)
  }, [])

  const handleCreateDetailType = useCallback(
    async (rawValue: string): Promise<string | null> => {
      const normalizedValue = normalizeStoryWorldDetailTypeValue(rawValue)
      if (!normalizedValue) {
        return ''
      }

      const existingOption = detailTypeOptions.find(
        (option) => option.value.toLocaleLowerCase() === normalizedValue.toLocaleLowerCase(),
      )
      if (existingOption) {
        return existingOption.value
      }

      setIsSavingDetailType(true)
      setError('')
      try {
        const createdType = await createStoryWorldDetailType({
          token: authToken,
          name: normalizedValue,
        })
        setDetailTypes((previous) => [...previous, createdType])
        return normalizeStoryWorldDetailTypeValue(createdType.name)
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Не удалось сохранить тип детали мира')
        return null
      } finally {
        setIsSavingDetailType(false)
      }
    },
    [authToken, detailTypeOptions],
  )

  const handleDetailTypeSelectionChange = useCallback(
    async (_event: unknown, option: WorldDetailTypeOption | null) => {
      if (!option) {
        setDetailTypeDraft('')
        return
      }
      if (option.isCreateAction) {
        const createdValue = await handleCreateDetailType(option.value)
        if (createdValue === null) {
          return
        }
        setDetailTypeDraft(createdValue)
        return
      }
      setDetailTypeDraft(option.value)
    },
    [handleCreateDetailType],
  )

  const handleSaveTemplate = useCallback(async () => {
    if (isSaving) {
      return
    }

    const normalizedTitle = titleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = contentDraft.replace(/\r\n/g, '\n').trim()
    let normalizedDetailType = normalizeStoryWorldDetailTypeValue(detailTypeDraft)

    if (!normalizedTitle) {
      setError(kind === 'world_profile' ? 'Название мира не может быть пустым' : 'Название детали не может быть пустым')
      return
    }
    if (!normalizedContent) {
      setError(kind === 'world_profile' ? 'Описание мира не может быть пустым' : 'Описание детали не может быть пустым')
      return
    }
    if (kind === 'world' && !normalizedDetailType) {
      setError('Укажите тип детали мира')
      return
    }

    if (kind === 'world' && normalizedDetailType) {
      const createdDetailType = await handleCreateDetailType(normalizedDetailType)
      if (createdDetailType === null) {
        return
      }
      normalizedDetailType = createdDetailType
    }

    setIsSaving(true)
    setError('')
    try {
      const preparedAvatarPayload = await prepareAvatarPayloadForRequest({
        avatarUrl: avatarDraft,
        avatarOriginalUrl: avatarOriginalDraft ?? avatarDraft,
        maxBytes: AVATAR_MAX_BYTES,
        maxDimension: 1280,
      })

      const savedTemplate = await createStoryWorldCardTemplate({
        token: authToken,
        title: normalizedTitle,
        content: normalizedContent,
        triggers: kind === 'world_profile' ? parseStoryWorldTriggers('', normalizedTitle) : parseStoryWorldTriggers(triggersDraft, normalizedTitle),
        kind,
        detail_type: kind === 'world' ? normalizedDetailType : '',
        avatar_url: preparedAvatarPayload.avatarUrl,
        avatar_original_url: preparedAvatarPayload.avatarOriginalUrl,
        avatar_scale: avatarScaleDraft,
        memory_turns: kind === 'world' ? memoryTurnsDraft : null,
      })

      setTemplates((previous) => {
        const nextItems = previous.filter((item) => item.id !== savedTemplate.id)
        nextItems.unshift(savedTemplate)
        return nextItems
      })
      setEditorOpen(false)
      onSelectTemplate(savedTemplate)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось сохранить шаблон карточки мира')
    } finally {
      setIsSaving(false)
    }
  }, [
    authToken,
    avatarDraft,
    avatarOriginalDraft,
    avatarScaleDraft,
    contentDraft,
    detailTypeDraft,
    handleCreateDetailType,
    isSaving,
    kind,
    memoryTurnsDraft,
    onSelectTemplate,
    titleDraft,
    triggersDraft,
  ])

  const renderCreateCard = (
    <ButtonBase
      onClick={openCreateEditor}
      sx={{
        width: '100%',
        minHeight: 82,
        borderRadius: '16px',
        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 76%, transparent)',
        backgroundColor: 'color-mix(in srgb, var(--morius-accent) 10%, transparent)',
        display: 'grid',
        placeItems: 'center',
        '&:hover': {
          backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, var(--morius-title-text) 14%)',
          borderColor: 'color-mix(in srgb, var(--morius-card-border) 88%, var(--morius-title-text) 12%)',
        },
      }}
    >
      <Box
        sx={{
          width: 42,
          height: 42,
          borderRadius: '50%',
          border: 'var(--morius-border-width) solid rgba(214, 226, 241, 0.62)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--morius-text-primary)',
          fontSize: '1.7rem',
          lineHeight: 1,
        }}
      >
        +
      </Box>
    </ButtonBase>
  )

  return (
    <>
      <BaseDialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
          width: { xs: 'calc(100vw - 24px)', sm: 'min(92vw, 860px)' },
          maxHeight: { xs: 'calc(100dvh - 18px)', sm: 'min(92vh, 960px)' },
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 0.8 }}>
          <Stack spacing={0.35}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.45rem', color: 'var(--morius-title-text)' }}>{title}</Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.92rem' }}>
              Выберите готовый шаблон или создайте новый прямо здесь.
            </Typography>
          </Stack>
        </DialogTitle>
        <DialogContent className="morius-scrollbar" sx={{ pt: 0.35, overflowY: 'auto' }}>
          <Stack spacing={0.9}>
            {error ? <Alert severity="error">{error}</Alert> : null}

            <Box
              component="input"
              value={searchQuery}
              placeholder={kind === 'world_profile' ? 'Поиск по названию и описанию мира' : 'Поиск по названию, описанию и типу детали'}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value.slice(0, 240))}
              sx={{
                width: '100%',
                minHeight: 40,
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, transparent)',
                backgroundColor: 'var(--morius-card-bg)',
                color: 'var(--morius-text-primary)',
                px: 1.1,
                outline: 'none',
                fontSize: '0.9rem',
              }}
            />

            {renderCreateCard}

            {isLoading ? (
              <Stack alignItems="center" justifyContent="center" sx={{ py: 2.2 }}>
                <CircularProgress size={24} />
              </Stack>
            ) : filteredTemplates.length === 0 ? (
              <Box
                sx={{
                  borderRadius: '16px',
                  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 90%, transparent)',
                  backgroundColor: 'var(--morius-elevated-bg)',
                  px: 1.2,
                  py: 1.15,
                }}
              >
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 700 }}>{emptyTitle}</Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', mt: 0.45 }}>{emptyDescription}</Typography>
              </Box>
            ) : (
              <Box className="morius-scrollbar" sx={{ maxHeight: 380, overflowY: 'auto', pr: 0.25 }}>
                <Stack spacing={0.65}>
                  {filteredTemplates.map((template) => (
                    <Box
                      key={template.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectTemplate(template)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onSelectTemplate(template)
                        }
                      }}
                      sx={{
                        width: '100%',
                        borderRadius: '16px',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        backgroundColor: 'var(--morius-elevated-bg)',
                        px: 1.05,
                        py: 0.9,
                        cursor: 'pointer',
                        transition: 'border-color 180ms ease, background-color 180ms ease',
                        '&:hover': {
                          borderColor: 'color-mix(in srgb, var(--morius-card-border) 86%, var(--morius-title-text) 14%)',
                          backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, var(--morius-title-text) 14%)',
                        },
                      }}
                    >
                      <Stack spacing={0.46}>
                        <Stack direction="row" spacing={0.7} justifyContent="space-between" alignItems="flex-start">
                          <Typography
                            sx={{
                              color: 'var(--morius-text-primary)',
                              fontSize: '1rem',
                              fontWeight: 800,
                              lineHeight: 1.2,
                              minWidth: 0,
                              flex: 1,
                            }}
                          >
                            {template.title}
                          </Typography>
                          <Typography sx={{ color: 'rgba(222, 231, 241, 0.82)', fontSize: '0.78rem', fontWeight: 700, flexShrink: 0 }}>
                            {formatMemoryLabel(template.memory_turns)}
                          </Typography>
                        </Stack>
                        <Typography
                          sx={{
                            color: 'var(--morius-text-secondary)',
                            fontSize: '0.86rem',
                            lineHeight: 1.38,
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                          }}
                        >
                          {template.content}
                        </Typography>
                        <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
                          <Typography sx={{ color: 'rgba(191, 205, 224, 0.82)', fontSize: '0.78rem', fontWeight: 700 }}>
                            {getStoryWorldTemplateEyebrow(template)}
                          </Typography>
                          <Typography sx={{ color: 'rgba(222, 231, 241, 0.88)', fontSize: '0.78rem', fontWeight: 700 }}>
                            Нажмите для выбора
                          </Typography>
                        </Stack>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        </DialogContent>
      </BaseDialog>

      <BaseDialog
        open={editorOpen}
        onClose={() => {
          if (!isSaving) {
            setEditorOpen(false)
          }
        }}
        maxWidth="sm"
        paperSx={{
          display: 'flex',
          flexDirection: 'column',
          maxHeight: { xs: 'calc(100dvh - 18px)', sm: 'min(92vh, 960px)' },
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {kind === 'world_profile' ? 'Новый шаблон мира' : 'Новая деталь мира'}
          </Typography>
        </DialogTitle>
        <DialogContent className="morius-scrollbar" sx={{ pt: 0.3, overflowY: 'auto' }}>
          <Stack spacing={1.05}>
            <WorldCardBannerPreview
              imageUrl={avatarOriginalDraft ?? avatarDraft}
              imageScale={avatarScaleDraft || 1}
              title="Баннер карточки"
              description="Добавьте широкое изображение для мира или детали."
              actionLabel={avatarDraft ? 'Перекадрировать баннер' : 'Выбрать баннер'}
              disabled={isSaving}
              onClick={handleOpenBannerEditor}
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7}>
              <Button onClick={handlePickBannerFile} disabled={isSaving} sx={{ minHeight: 36, flex: 1 }}>
                {avatarDraft ? 'Заменить баннер' : 'Загрузить баннер'}
              </Button>
              <Button onClick={handleOpenBannerEditor} disabled={isSaving} sx={{ minHeight: 36, flex: 1 }}>
                {avatarDraft ? 'Перекадрировать' : 'Выбрать баннер'}
              </Button>
              {avatarDraft ? (
                <Button
                  onClick={() => {
                    setAvatarDraft(null)
                    setAvatarOriginalDraft(null)
                    setAvatarScaleDraft(1)
                  }}
                  disabled={isSaving}
                  sx={{ minHeight: 36, flex: 1, color: 'var(--morius-title-text)' }}
                >
                  Убрать
                </Button>
              ) : null}
            </Stack>

            {kind === 'world' ? (
              <Autocomplete<WorldDetailTypeOption, false, false, false>
                options={detailTypeOptions}
                value={selectedDetailTypeOption}
                inputValue={detailTypeDraft}
                onInputChange={(_event, nextValue, reason) => {
                  if (reason === 'reset') {
                    setDetailTypeDraft(selectedDetailTypeOption?.value ?? '')
                    return
                  }
                  setDetailTypeDraft(nextValue.slice(0, DETAIL_TYPE_MAX_LENGTH))
                }}
                onChange={(event, nextValue) => {
                  void handleDetailTypeSelectionChange(event, nextValue)
                }}
                filterOptions={(options, params) => {
                  const filtered = filterWorldDetailTypeOptions(options, params)
                  const normalizedInputValue = normalizeStoryWorldDetailTypeValue(params.inputValue)
                  const hasExactMatch = options.some(
                    (option) => option.value.toLocaleLowerCase() === normalizedInputValue.toLocaleLowerCase(),
                  )
                  if (normalizedInputValue && !hasExactMatch) {
                    filtered.push({
                      label: `Добавить: ${normalizedInputValue}`,
                      value: normalizedInputValue,
                      isCreateAction: true,
                    })
                  }
                  return filtered
                }}
                getOptionLabel={(option) => option.label}
                isOptionEqualToValue={(option, value) => option.value === value.value && option.isCreateAction === value.isCreateAction}
                loading={isSavingDetailType || isLoading}
                disabled={isSaving}
                fullWidth
                noOptionsText="Типы не найдены"
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Тип"
                    placeholder="Место, предмет, заклинание, моб..."
                    inputProps={{
                      ...params.inputProps,
                      maxLength: DETAIL_TYPE_MAX_LENGTH,
                    }}
                    helperText={<TextLimitIndicator currentLength={normalizedDetailTypeDraft.length} maxLength={DETAIL_TYPE_MAX_LENGTH} />}
                    FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {isSavingDetailType || isLoading ? <CircularProgress color="inherit" size={16} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
            ) : null}

            <TextField
              label={kind === 'world_profile' ? 'Название мира' : 'Название детали'}
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value.slice(0, TEMPLATE_TITLE_MAX_LENGTH))}
              inputProps={{ maxLength: TEMPLATE_TITLE_MAX_LENGTH }}
              helperText={<TextLimitIndicator currentLength={titleDraft.length} maxLength={TEMPLATE_TITLE_MAX_LENGTH} />}
              FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
            />

            <TextField
              label={kind === 'world_profile' ? 'Описание мира' : 'Описание'}
              value={contentDraft}
              onChange={(event) => setContentDraft(event.target.value.slice(0, TEMPLATE_CONTENT_MAX_LENGTH))}
              multiline
              minRows={kind === 'world_profile' ? 6 : 4}
              maxRows={kind === 'world_profile' ? 12 : 8}
              placeholder={
                kind === 'world_profile'
                  ? 'Опишите лор мира, его правила, атмосферу, расы, магию, технологии и общий контекст.'
                  : 'Опишите место, предмет, заклинание, моба или другую важную деталь.'
              }
              inputProps={{ maxLength: TEMPLATE_CONTENT_MAX_LENGTH }}
              helperText={<TextLimitIndicator currentLength={contentDraft.length} maxLength={TEMPLATE_CONTENT_MAX_LENGTH} />}
              FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
            />

            {kind === 'world_profile' ? (
              <Alert severity="info" sx={{ borderRadius: '14px' }}>
                Карточка мира задает общий лор и правила. В игре она используется как постоянная карточка описания мира.
              </Alert>
            ) : (
              <>
                <TextField
                  label="Триггеры"
                  value={triggersDraft}
                  onChange={(event) => setTriggersDraft(event.target.value.slice(0, TEMPLATE_TRIGGER_INPUT_MAX_LENGTH))}
                  multiline
                  minRows={2}
                  maxRows={4}
                  placeholder="Через запятую: храм, артефакт, некромантия"
                  inputProps={{ maxLength: TEMPLATE_TRIGGER_INPUT_MAX_LENGTH }}
                  helperText={<TextLimitIndicator currentLength={triggersDraft.length} maxLength={TEMPLATE_TRIGGER_INPUT_MAX_LENGTH} />}
                  FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
                />

                <TextField
                  select
                  label="Память в контексте"
                  value={memoryTurnsDraft === null ? 'always' : memoryTurnsDraft <= 0 ? 'off' : String(memoryTurnsDraft)}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    if (nextValue === 'always') {
                      setMemoryTurnsDraft(null)
                      return
                    }
                    if (nextValue === 'off') {
                      setMemoryTurnsDraft(0)
                      return
                    }
                    setMemoryTurnsDraft(Number(nextValue))
                  }}
                >
                  <MenuItem value="off">Отключено</MenuItem>
                  <MenuItem value="3">3 хода</MenuItem>
                  <MenuItem value="5">5 ходов</MenuItem>
                  <MenuItem value="10">10 ходов</MenuItem>
                  <MenuItem value="always">Помнить всегда</MenuItem>
                </TextField>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.5 }}>
          <Button
            onClick={() => setEditorOpen(false)}
            disabled={isSaving}
            sx={{ color: 'var(--morius-title-text)', backgroundColor: 'transparent', '&:hover': { backgroundColor: 'rgba(255,255,255,0.04)' } }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => void handleSaveTemplate()}
            disabled={isSaving}
            sx={{
              color: 'var(--morius-accent)',
              backgroundColor: 'transparent',
              '&:hover': { backgroundColor: 'rgba(255,255,255,0.04)' },
            }}
          >
            {isSaving ? <CircularProgress size={16} sx={{ color: 'var(--morius-accent)' }} /> : 'Создать'}
          </Button>
        </DialogActions>
      </BaseDialog>

      <input
        ref={avatarInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleBannerChange}
        style={{ display: 'none' }}
      />

      {avatarCropSource ? (
        <ImageCropper
          imageSrc={avatarCropSource}
          aspect={STORY_WORLD_BANNER_ASPECT}
          frameRadius={20}
          title="Настройка баннера карточки"
          onCancel={() => setAvatarCropSource(null)}
          onSave={handleSaveCroppedBanner}
        />
      ) : null}
    </>
  )
}

export default WorldCardTemplatePickerDialog
