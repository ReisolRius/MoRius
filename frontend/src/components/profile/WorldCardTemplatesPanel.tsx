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
import CharacterShowcaseCard from '../characters/CharacterShowcaseCard'
import TextLimitIndicator from '../TextLimitIndicator'
import WorldCardBannerPreview from '../story/WorldCardBannerPreview'
import {
  createStoryWorldCardTemplate,
  createStoryWorldDetailType,
  deleteStoryWorldCardTemplate,
  listStoryWorldCardTemplates,
  listStoryWorldDetailTypes,
  updateStoryWorldCardTemplate,
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

type WorldCardTemplatesPanelProps = {
  authToken: string
  searchQuery?: string
  onTemplatesCountChange?: (count: number) => void
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

function WorldCardTemplatesPanel({ authToken, searchQuery = '', onTemplatesCountChange }: WorldCardTemplatesPanelProps) {
  const [templates, setTemplates] = useState<StoryWorldCardTemplate[]>([])
  const [detailTypes, setDetailTypes] = useState<StoryWorldDetailType[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null)
  const [kindDraft, setKindDraft] = useState<StoryWorldCardTemplateKind>('world_profile')
  const [detailTypeDraft, setDetailTypeDraft] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  const [triggersDraft, setTriggersDraft] = useState('')
  const [memoryTurnsDraft, setMemoryTurnsDraft] = useState<number | null>(null)
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  const [avatarOriginalDraft, setAvatarOriginalDraft] = useState<string | null>(null)
  const [avatarScaleDraft, setAvatarScaleDraft] = useState(1)
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSavingDetailType, setIsSavingDetailType] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  const refreshData = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const [loadedTemplates, loadedDetailTypes] = await Promise.all([
        listStoryWorldCardTemplates({ token: authToken }),
        listStoryWorldDetailTypes({ token: authToken }),
      ])
      setTemplates(loadedTemplates)
      setDetailTypes(loadedDetailTypes)
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось загрузить карточки мира'
      setError(detail)
      setTemplates([])
      setDetailTypes([])
    } finally {
      setIsLoading(false)
    }
  }, [authToken])

  useEffect(() => {
    void refreshData()
  }, [refreshData])

  useEffect(() => {
    onTemplatesCountChange?.(templates.length)
  }, [onTemplatesCountChange, templates.length])

  const normalizedSearchQuery = useMemo(
    () => searchQuery.replace(/\s+/g, ' ').trim().toLocaleLowerCase(),
    [searchQuery],
  )

  const worldProfileTemplates = useMemo(
    () =>
      [...templates
        .filter((item) => item.kind === 'world_profile')
        .filter((item) =>
          !normalizedSearchQuery
            ? true
            : [item.title, item.content, item.detail_type, item.triggers.join(' ')]
                .join(' ')
                .toLocaleLowerCase()
                .includes(normalizedSearchQuery),
        )].sort(
        (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at) || right.id - left.id,
      ),
    [normalizedSearchQuery, templates],
  )
  const worldDetailTemplates = useMemo(
    () =>
      [...templates
        .filter((item) => item.kind === 'world')
        .filter((item) =>
          !normalizedSearchQuery
            ? true
            : [item.title, item.content, item.detail_type, item.triggers.join(' ')]
                .join(' ')
                .toLocaleLowerCase()
                .includes(normalizedSearchQuery),
        )].sort(
        (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at) || right.id - left.id,
      ),
    [normalizedSearchQuery, templates],
  )

  const detailTypeSuggestionLabels = useMemo(
    () => buildStoryWorldDetailTypeSuggestions(detailTypes, [detailTypeDraft]),
    [detailTypeDraft, detailTypes],
  )
  const detailTypeOptions = useMemo<WorldDetailTypeOption[]>(
    () => detailTypeSuggestionLabels.map((label) => ({ label, value: label })),
    [detailTypeSuggestionLabels],
  )
  const normalizedDetailTypeDraft = useMemo(
    () => normalizeStoryWorldDetailTypeValue(detailTypeDraft),
    [detailTypeDraft],
  )
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

  const resetEditor = useCallback(() => {
    setEditorOpen(false)
    setEditingTemplateId(null)
    setKindDraft('world_profile')
    setDetailTypeDraft('')
    setTitleDraft('')
    setContentDraft('')
    setTriggersDraft('')
    setMemoryTurnsDraft(null)
    setAvatarDraft(null)
    setAvatarOriginalDraft(null)
    setAvatarScaleDraft(1)
    setAvatarCropSource(null)
    setIsSaving(false)
    setIsDeleting(false)
    setIsSavingDetailType(false)
  }, [])

  const openCreate = useCallback((kind: StoryWorldCardTemplateKind) => {
    setEditorOpen(true)
    setEditingTemplateId(null)
    setKindDraft(kind)
    setDetailTypeDraft('')
    setTitleDraft('')
    setContentDraft('')
    setTriggersDraft('')
    setMemoryTurnsDraft(kind === 'world' ? 5 : null)
    setAvatarDraft(null)
    setAvatarOriginalDraft(null)
    setAvatarScaleDraft(1)
    setAvatarCropSource(null)
    setError('')
  }, [])

  const openEdit = useCallback((template: StoryWorldCardTemplate) => {
    setEditorOpen(true)
    setEditingTemplateId(template.id)
    setKindDraft(template.kind)
    setDetailTypeDraft(normalizeStoryWorldDetailTypeValue(template.detail_type))
    setTitleDraft(template.title)
    setContentDraft(template.content)
    setTriggersDraft(template.triggers.join(', '))
    setMemoryTurnsDraft(template.kind === 'world' ? template.memory_turns : null)
    setAvatarDraft(template.avatar_url)
    setAvatarOriginalDraft(template.avatar_original_url ?? template.avatar_url)
    setAvatarScaleDraft(template.avatar_scale || 1)
    setAvatarCropSource(null)
    setError('')
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
        const detail = requestError instanceof Error ? requestError.message : 'Не удалось сохранить тип детали мира'
        setError(detail)
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

  const handleOpenAvatarEditor = useCallback(() => {
    if (isSaving || isDeleting) {
      return
    }
    const cropSource = avatarOriginalDraft ?? avatarDraft
    if (cropSource) {
      setAvatarCropSource(cropSource)
      return
    }
    avatarInputRef.current?.click()
  }, [avatarDraft, avatarOriginalDraft, isDeleting, isSaving])

  const handlePickAvatarFile = useCallback(() => {
    if (isSaving || isDeleting) {
      return
    }
    avatarInputRef.current?.click()
  }, [isDeleting, isSaving])

  const handleAvatarChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
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
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось обработать изображение карточки мира'
      setError(detail)
    }
  }, [])

  const handleSaveCroppedAvatar = useCallback((croppedDataUrl: string) => {
    if (!croppedDataUrl) {
      return
    }
    setAvatarDraft(croppedDataUrl)
    setAvatarOriginalDraft(croppedDataUrl)
    setAvatarScaleDraft(1)
    setAvatarCropSource(null)
  }, [])

  const handleSaveTemplate = useCallback(async () => {
    if (isSaving || isDeleting) {
      return
    }

    const normalizedTitle = titleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = contentDraft.replace(/\r\n/g, '\n').trim()
    let normalizedDetailType = normalizeStoryWorldDetailTypeValue(detailTypeDraft)

    if (!normalizedTitle) {
      setError('Название карточки мира не может быть пустым')
      return
    }
    if (!normalizedContent) {
      setError('Описание карточки мира не может быть пустым')
      return
    }
    if (kindDraft === 'world' && !normalizedDetailType) {
      setError('Укажите тип детали мира')
      return
    }

    if (kindDraft === 'world' && normalizedDetailType) {
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
      const payload = {
        token: authToken,
        title: normalizedTitle,
        content: normalizedContent,
        triggers: kindDraft === 'world_profile' ? parseStoryWorldTriggers('', normalizedTitle) : parseStoryWorldTriggers(triggersDraft, normalizedTitle),
        kind: kindDraft,
        detail_type: kindDraft === 'world' ? normalizedDetailType : '',
        avatar_url: preparedAvatarPayload.avatarUrl,
        avatar_original_url: preparedAvatarPayload.avatarOriginalUrl,
        avatar_scale: avatarScaleDraft,
        memory_turns: kindDraft === 'world' ? memoryTurnsDraft : null,
      }
      const savedTemplate =
        editingTemplateId === null
          ? await createStoryWorldCardTemplate(payload)
          : await updateStoryWorldCardTemplate({
              ...payload,
              templateId: editingTemplateId,
            })
      setTemplates((previous) => {
        const nextItems = previous.filter((item) => item.id !== savedTemplate.id)
        nextItems.push(savedTemplate)
        return nextItems
      })
      resetEditor()
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось сохранить карточку мира'
      setError(detail)
    } finally {
      setIsSaving(false)
    }
  }, [
    authToken,
    avatarDraft,
    avatarOriginalDraft,
    avatarScaleDraft,
    detailTypeDraft,
    editingTemplateId,
    handleCreateDetailType,
    isDeleting,
    isSaving,
    kindDraft,
    memoryTurnsDraft,
    resetEditor,
    titleDraft,
    contentDraft,
    triggersDraft,
  ])

  const handleDeleteTemplate = useCallback(async () => {
    if (editingTemplateId === null || isSaving || isDeleting) {
      return
    }
    setIsDeleting(true)
    setError('')
    try {
      await deleteStoryWorldCardTemplate({
        token: authToken,
        templateId: editingTemplateId,
      })
      setTemplates((previous) => previous.filter((item) => item.id !== editingTemplateId))
      resetEditor()
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : 'Не удалось удалить карточку мира'
      setError(detail)
    } finally {
      setIsDeleting(false)
    }
  }, [authToken, editingTemplateId, isDeleting, isSaving, resetEditor])

  const renderCreateCard = (kind: StoryWorldCardTemplateKind) => (
    <ButtonBase
      onClick={() => openCreate(kind)}
      aria-label={kind === 'world_profile' ? 'Создать шаблон мира' : 'Создать шаблон детали мира'}
      sx={{
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        minHeight: 304,
        p: 1.2,
        borderRadius: '18px',
        border: 'var(--morius-border-width) dashed color-mix(in srgb, var(--morius-card-border) 74%, transparent)',
        backgroundColor: 'color-mix(in srgb, var(--morius-accent) 10%, transparent)',
        display: 'grid',
        placeItems: 'center',
        '&:hover': {
          backgroundColor: 'transparent',
          borderColor: 'color-mix(in srgb, var(--morius-accent) 66%, transparent)',
        },
      }}
    >
      <Box
        sx={{
          width: 50,
          height: 50,
          borderRadius: '50%',
          border: 'var(--morius-border-width) solid rgba(214, 226, 241, 0.62)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--morius-text-primary)',
          fontSize: '1.8rem',
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        +
      </Box>
    </ButtonBase>
  )

  const renderSection = (options: {
    title: string
    emptyText: string
    kind: StoryWorldCardTemplateKind
    items: StoryWorldCardTemplate[]
  }) => (
    <Stack spacing={1} sx={{ width: '100%', minWidth: 0 }}>
      <Typography sx={{ fontSize: { xs: '1.03rem', md: '1.14rem' }, fontWeight: 800 }}>{options.title}</Typography>
      {!options.items.length ? (
        <>
          {renderCreateCard(options.kind)}
          <Typography sx={{ color: 'var(--morius-text-secondary)' }}>{options.emptyText}</Typography>
        </>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 1,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
            width: '100%',
            minWidth: 0,
          }}
        >
          {renderCreateCard(options.kind)}
          {options.items.map((item) => (
            <CharacterShowcaseCard
              key={item.id}
              title={item.title}
              description={item.content}
              imageUrl={item.avatar_url}
              imageScale={item.avatar_scale}
              eyebrow={getStoryWorldTemplateEyebrow(item)}
              footerHint="Нажмите для редактирования"
              metaPrimary={item.kind === 'world_profile' ? 'Мир' : item.detail_type || 'Деталь'}
              metaSecondary={formatMemoryLabel(item.memory_turns)}
              onClick={() => openEdit(item)}
            />
          ))}
        </Box>
      )}
    </Stack>
  )

  return (
    <Stack spacing={1.1} sx={{ width: '100%', minWidth: 0 }}>
      {error ? (
        <Alert severity="error" onClose={() => setError('')} sx={{ borderRadius: '12px' }}>
          {error}
        </Alert>
      ) : null}

      {isLoading ? (
        <Stack spacing={1}>
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
            {Array.from({ length: 4 }, (_, index) => (
              <Box
                key={`world-template-skeleton-${index}`}
                sx={{
                  minHeight: 304,
                  borderRadius: '18px',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                  backgroundColor: 'var(--morius-elevated-bg)',
                }}
              />
            ))}
          </Box>
        </Stack>
      ) : (
        <>
          {renderSection({
            title: 'Мир',
            emptyText: 'У вас пока нет карточек мира.',
            kind: 'world_profile',
            items: worldProfileTemplates,
          })}
          {renderSection({
            title: 'Связанное с миром',
            emptyText: 'У вас пока нет связанных карточек мира.',
            kind: 'world',
            items: worldDetailTemplates,
          })}
        </>
      )}

      <BaseDialog
        open={editorOpen}
        onClose={() => {
          if (!isSaving && !isDeleting) {
            resetEditor()
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
            {editingTemplateId === null
              ? kindDraft === 'world_profile'
                ? 'Новая карточка мира'
                : 'Новая деталь мира'
              : kindDraft === 'world_profile'
                ? 'Редактирование карточки мира'
                : 'Редактирование детали мира'}
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
              disabled={isSaving || isDeleting}
              onClick={handleOpenAvatarEditor}
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7}>
              <Button onClick={handlePickAvatarFile} disabled={isSaving || isDeleting} sx={{ minHeight: 36, flex: 1 }}>
                {avatarDraft ? 'Заменить баннер' : 'Загрузить баннер'}
              </Button>
              <Button onClick={handleOpenAvatarEditor} disabled={isSaving || isDeleting} sx={{ minHeight: 36, flex: 1 }}>
                {avatarDraft ? 'Перекадрировать' : 'Выбрать баннер'}
              </Button>
              {avatarDraft ? (
                <Button
                  onClick={() => {
                    setAvatarDraft(null)
                    setAvatarOriginalDraft(null)
                    setAvatarScaleDraft(1)
                  }}
                  disabled={isSaving || isDeleting}
                  sx={{ minHeight: 36, flex: 1, color: 'var(--morius-title-text)' }}
                >
                  Убрать
                </Button>
              ) : null}
            </Stack>

            <TextField
              select
              label="Раздел"
              value={kindDraft}
              onChange={(event) => {
                const nextKind = event.target.value === 'world' ? 'world' : 'world_profile'
                setKindDraft(nextKind)
                if (nextKind === 'world_profile') {
                  setDetailTypeDraft('')
                  setMemoryTurnsDraft(null)
                } else if (memoryTurnsDraft === null) {
                  setMemoryTurnsDraft(5)
                }
              }}
            >
              <MenuItem value="world_profile">Мир</MenuItem>
              <MenuItem value="world">Связанное с миром</MenuItem>
            </TextField>

            {kindDraft === 'world' ? (
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
                loading={isSavingDetailType}
                disabled={isSaving || isDeleting}
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
                  />
                )}
              />
            ) : null}

            <TextField
              label={kindDraft === 'world_profile' ? 'Название мира' : 'Название детали'}
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value.slice(0, TEMPLATE_TITLE_MAX_LENGTH))}
              inputProps={{ maxLength: TEMPLATE_TITLE_MAX_LENGTH }}
              helperText={<TextLimitIndicator currentLength={titleDraft.length} maxLength={TEMPLATE_TITLE_MAX_LENGTH} />}
              FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
            />

            <TextField
              label={kindDraft === 'world_profile' ? 'Описание мира' : 'Описание'}
              value={contentDraft}
              onChange={(event) => setContentDraft(event.target.value.slice(0, TEMPLATE_CONTENT_MAX_LENGTH))}
              multiline
              minRows={kindDraft === 'world_profile' ? 6 : 4}
              maxRows={kindDraft === 'world_profile' ? 12 : 8}
              placeholder={
                kindDraft === 'world_profile'
                  ? 'Опишите лор мира, его правила, атмосферу, расы, магию, технологии и общий контекст.'
                  : 'Опишите место, предмет, заклинание, моба или другую важную деталь.'
              }
              inputProps={{ maxLength: TEMPLATE_CONTENT_MAX_LENGTH }}
              helperText={<TextLimitIndicator currentLength={contentDraft.length} maxLength={TEMPLATE_CONTENT_MAX_LENGTH} />}
              FormHelperTextProps={{ component: 'div', sx: { m: 0, mt: 0.55 } }}
            />

            {kindDraft === 'world_profile' ? (
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
        <DialogActions sx={{ px: 3, pb: 2.2, pt: 0.5, justifyContent: editingTemplateId !== null ? 'space-between' : 'flex-end' }}>
          {editingTemplateId !== null ? (
            <Button onClick={() => void handleDeleteTemplate()} disabled={isSaving || isDeleting} sx={{ color: '#e99292' }}>
              {isDeleting ? <CircularProgress size={16} sx={{ color: '#e99292' }} /> : 'Удалить'}
            </Button>
          ) : <Box />}
          <Stack direction="row" spacing={0.8}>
            <Button onClick={resetEditor} disabled={isSaving || isDeleting} sx={{ color: 'var(--morius-title-text)' }}>
              Отмена
            </Button>
            <Button
              onClick={() => void handleSaveTemplate()}
              disabled={isSaving || isDeleting}
              sx={{
                color: 'var(--morius-accent)',
                backgroundColor: 'transparent',
                '&:hover': { backgroundColor: 'rgba(255,255,255,0.04)' },
              }}
            >
              {isSaving ? <CircularProgress size={16} sx={{ color: 'var(--morius-accent)' }} /> : editingTemplateId === null ? 'Создать' : 'Сохранить'}
            </Button>
          </Stack>
        </DialogActions>
      </BaseDialog>

      <input
        ref={avatarInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleAvatarChange}
        style={{ display: 'none' }}
      />

      {avatarCropSource ? (
        <ImageCropper
          imageSrc={avatarCropSource}
          aspect={STORY_WORLD_BANNER_ASPECT}
          frameRadius={20}
          title="Настройка баннера карточки"
          onCancel={() => setAvatarCropSource(null)}
          onSave={handleSaveCroppedAvatar}
        />
      ) : null}
    </Stack>
  )
}

export default WorldCardTemplatesPanel
