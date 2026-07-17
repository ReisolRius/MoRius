import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Skeleton,
  Stack,
  SvgIcon,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import type { StoryImageModelId, StorySceneBackground } from '../../types/story'
import {
  DEFAULT_STORY_BACKGROUND_IMAGE_MODEL,
  STORY_IMAGE_MODEL_OPTIONS_SHARED,
} from '../../constants/storyImageModels'
import BaseDialog from '../dialogs/BaseDialog'
import ProgressiveImage from '../media/ProgressiveImage'

const MAX_PLACE_IMAGE_BYTES = 8 * 1024 * 1024

export type NovelPlaceTemplate = {
  id: number
  title: string
  image_url: string | null
  triggers: string[]
  created_at?: string
  updated_at?: string
}

export type NovelPlaceSavePayload = {
  id?: number
  title: string
  triggers: string[]
  imageUrl?: string | null
}

type AsyncCallbackResult = void | Promise<void>

export type NovelPlaceGeneratePayload = {
  placeId?: number
  title?: string
  description?: string
  stylePrompt?: string
  imageModel?: StoryImageModelId
  triggers?: string[]
  makeCurrent?: boolean
  createNewPlace?: boolean
}

export type NovelPlacesPanelProps = {
  places: StorySceneBackground[]
  currentPlace?: StorySceneBackground | null
  profileTemplates?: NovelPlaceTemplate[]
  loading?: boolean
  saving?: boolean
  generating?: boolean
  error?: string | null
  onRefresh?: () => AsyncCallbackResult
  defaultImageModel?: StoryImageModelId
  defaultStylePrompt?: string
  onGenerate: (
    request?: number | NovelPlaceGeneratePayload,
  ) => void | StorySceneBackground | Promise<void | StorySceneBackground>
  onSelect: (placeId: number) => AsyncCallbackResult
  onSave: (place: NovelPlaceSavePayload) => AsyncCallbackResult
  onDelete: (placeId: number) => AsyncCallbackResult
  onImport?: (templateId: number) => AsyncCallbackResult
}

type PlaceEditorState = {
  id?: number
  title: string
  triggersText: string
  imageUrl: string | null
  description: string
  stylePrompt: string
  imageModel: StoryImageModelId
  initialTitle: string
  initialTriggersText: string
  initialImageUrl: string | null
  initialDescription: string
  initialStylePrompt: string
  initialImageModel: StoryImageModelId
}

type PanelIconName =
  | 'add'
  | 'check'
  | 'delete'
  | 'edit'
  | 'generate'
  | 'image'
  | 'library'
  | 'place'
  | 'refresh'

const ICON_PATHS: Record<PanelIconName, ReactNode> = {
  add: <path d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z" fill="currentColor" />,
  check: <path d="M9.2 16.2 4.9 12a1 1 0 0 1 1.4-1.4l2.9 2.8 8.5-8.5a1 1 0 1 1 1.4 1.4l-9.2 9.9a1 1 0 0 1-.7.3 1 1 0 0 1-.7-.3Z" fill="currentColor" />,
  delete: <path d="M8 4V3a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1h4a1 1 0 1 1 0 2h-1l-.8 13a3 3 0 0 1-3 3H8.8a3 3 0 0 1-3-3L5 6H4a1 1 0 0 1 0-2h4Zm2 0h4V3h-4v1Zm-3 2 .8 12.9c0 .6.5 1.1 1.1 1.1h6.2c.6 0 1.1-.5 1.1-1.1L17 6H7Zm3 3a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z" fill="currentColor" />,
  edit: <path d="m16.9 2.6 4.5 4.5-12 12-5.7 1.2 1.2-5.7 12-12Zm0 2.8L6.7 15.6l-.4 2.1 2.1-.4L18.6 7.1l-1.7-1.7ZM19 1.9a1.5 1.5 0 0 1 2.1 0l1 1a1.5 1.5 0 0 1 0 2.1l-1.4 1.4-3.1-3.1L19 1.9Z" fill="currentColor" />,
  generate: <path d="M12 2a1 1 0 0 1 .9.6l1.4 3.1a7 7 0 0 0 3.5 3.5l3.1 1.4a1 1 0 0 1 0 1.8l-3.1 1.4a7 7 0 0 0-3.5 3.5l-1.4 3.1a1 1 0 0 1-1.8 0l-1.4-3.1a7 7 0 0 0-3.5-3.5l-3.1-1.4a1 1 0 0 1 0-1.8l3.1-1.4a7 7 0 0 0 3.5-3.5l1.4-3.1A1 1 0 0 1 12 2Zm0 3.4-.5 1.1a9 9 0 0 1-4.4 4.4l-1.1.5 1.1.5a9 9 0 0 1 4.4 4.4l.5 1.1.5-1.1a9 9 0 0 1 4.4-4.4l1.1-.5-1.1-.5a9 9 0 0 1-4.4-4.4L12 5.4Z" fill="currentColor" />,
  image: <path d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v11.2l4-4a2 2 0 0 1 2.8 0l2.2 2.2 1.2-1.2a2 2 0 0 1 2.8 0l3 3V5H4Zm16 14-4.4-4.4-3.2 3.2a1 1 0 0 1-1.4-1.4l.6-.6-2.2-2.2L4 19h16ZM15.5 7a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm0 2a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z" fill="currentColor" />,
  library: <path d="M5 3h14a2 2 0 0 1 2 2v15a1 1 0 0 1-1.5.9L12 16.7l-7.5 4.2A1 1 0 0 1 3 20V5a2 2 0 0 1 2-2Zm0 2v13.3l6.5-3.6a1 1 0 0 1 1 0l6.5 3.6V5H5Z" fill="currentColor" />,
  place: <path d="M12 2a8 8 0 0 1 8 8c0 5.3-6.6 11-7.3 11.6a1 1 0 0 1-1.4 0C10.6 21 4 15.3 4 10a8 8 0 0 1 8-8Zm0 2a6 6 0 0 0-6 6c0 3.5 4 7.6 6 9.5 2-1.9 6-6 6-9.5a6 6 0 0 0-6-6Zm0 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" fill="currentColor" />,
  refresh: <path d="M20.5 5.5V2a1 1 0 1 1 2 0v6a1 1 0 0 1-1 1h-6a1 1 0 1 1 0-2h3.8A8 8 0 1 0 20 16a1 1 0 1 1 1.7 1 10 10 0 1 1-.6-11.4l-.6-.1Z" fill="currentColor" />,
}

function PanelIcon({ name, size = 20 }: { name: PanelIconName; size?: number }) {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: size, height: size }}>
      {ICON_PATHS[name]}
    </SvgIcon>
  )
}

function parseTriggers(value: string): string[] {
  const seen = new Set<string>()
  return value
    .split(/[\n,;]+/)
    .map((trigger) => trigger.trim())
    .filter((trigger) => {
      if (!trigger) {
        return false
      }
      const normalizedTrigger = trigger.toLocaleLowerCase('ru-RU')
      if (seen.has(normalizedTrigger)) {
        return false
      }
      seen.add(normalizedTrigger)
      return true
    })
}

function formatTriggers(triggers: string[]): string {
  return triggers.join('\n')
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return fallback
}

function createEditorState(
  place: StorySceneBackground | undefined,
  imageModel: StoryImageModelId,
  stylePrompt: string,
): PlaceEditorState {
  const title = place?.title ?? ''
  const triggersText = formatTriggers(place?.triggers ?? [])
  const imageUrl = place?.image_url ?? null
  return {
    id: place?.id,
    title,
    triggersText,
    imageUrl,
    description: place?.prompt ?? '',
    stylePrompt,
    imageModel,
    initialTitle: title,
    initialTriggersText: triggersText,
    initialImageUrl: imageUrl,
    initialDescription: place?.prompt ?? '',
    initialStylePrompt: stylePrompt,
    initialImageModel: imageModel,
  }
}

function PlaceImageFallback({ compact = false }: { compact?: boolean }) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={0.55}
      sx={{
        width: '100%',
        height: '100%',
        color: 'var(--morius-text-secondary)',
        background:
          'radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--morius-accent) 14%, transparent), transparent 42%), linear-gradient(155deg, color-mix(in srgb, var(--morius-elevated-bg) 92%, #000 8%), color-mix(in srgb, var(--morius-card-bg) 90%, #000 10%))',
      }}
    >
      <PanelIcon name="place" size={compact ? 24 : 32} />
      {!compact ? (
        <Typography sx={{ fontSize: '0.78rem', color: 'inherit' }}>Фон ещё не добавлен</Typography>
      ) : null}
    </Stack>
  )
}

function NovelPlacesPanel({
  places,
  currentPlace,
  profileTemplates = [],
  loading = false,
  saving = false,
  generating = false,
  error = null,
  defaultImageModel = DEFAULT_STORY_BACKGROUND_IMAGE_MODEL,
  defaultStylePrompt = '',
  onRefresh,
  onGenerate,
  onSelect,
  onSave,
  onDelete,
  onImport,
}: NovelPlacesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [editor, setEditor] = useState<PlaceEditorState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StorySceneBackground | null>(null)
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [pendingGenerateId, setPendingGenerateId] = useState<number | null | undefined>(undefined)
  const [pendingSelectId, setPendingSelectId] = useState<number | null>(null)
  const [pendingImportId, setPendingImportId] = useState<number | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const resolvedCurrentPlace = useMemo(
    () => currentPlace ?? places.find((place) => place.is_current) ?? null,
    [currentPlace, places],
  )
  const currentPlaceId = resolvedCurrentPlace?.id ?? null
  const isBusy = loading || saving || generating
  const editorTriggers = useMemo(() => parseTriggers(editor?.triggersText ?? ''), [editor?.triggersText])
  const editorHasChanges = Boolean(
    editor &&
      (editor.title !== editor.initialTitle ||
        editor.triggersText !== editor.initialTriggersText ||
        editor.imageUrl !== editor.initialImageUrl ||
        editor.description !== editor.initialDescription ||
        editor.stylePrompt !== editor.initialStylePrompt ||
        editor.imageModel !== editor.initialImageModel),
  )

  const runGenerate = async (request?: number | NovelPlaceGeneratePayload) => {
    const placeId = typeof request === 'number' ? request : request?.placeId
    setLocalError(null)
    setPendingGenerateId(placeId ?? null)
    try {
      return await onGenerate(request)
    } catch (generateError) {
      setLocalError(getErrorMessage(generateError, 'Не удалось сгенерировать фон.'))
    } finally {
      setPendingGenerateId(undefined)
    }
  }

  const handleGenerateEditorBackground = async () => {
    if (!editor) return
    const title = editor.title.trim()
    const description = editor.description.trim()
    if (!title) {
      setLocalError('Укажите название места.')
      return
    }
    if (!description) {
      setLocalError('Опишите, какой фон нужно сгенерировать.')
      return
    }
    const result = await runGenerate({
      placeId: editor.id,
      title,
      description,
      stylePrompt: editor.stylePrompt.trim(),
      imageModel: editor.imageModel,
      triggers: editorTriggers,
      makeCurrent: false,
      createNewPlace: !editor.id,
    })
    if (result) setEditor(null)
  }

  const runSelect = async (placeId: number) => {
    setLocalError(null)
    setPendingSelectId(placeId)
    try {
      await onSelect(placeId)
    } catch (selectError) {
      setLocalError(getErrorMessage(selectError, 'Не удалось выбрать место.'))
    } finally {
      setPendingSelectId(null)
    }
  }

  const runRefresh = async () => {
    if (!onRefresh) {
      return
    }
    setLocalError(null)
    setIsRefreshing(true)
    try {
      await onRefresh()
    } catch (refreshError) {
      setLocalError(getErrorMessage(refreshError, 'Не удалось обновить список мест.'))
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    if (!file.type.startsWith('image/')) {
      setLocalError('Выберите файл изображения.')
      return
    }
    if (file.size > MAX_PLACE_IMAGE_BYTES) {
      setLocalError('Изображение должно быть меньше 8 МБ.')
      return
    }

    const reader = new FileReader()
    reader.onerror = () => setLocalError('Не удалось прочитать изображение.')
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setLocalError('Не удалось прочитать изображение.')
        return
      }
      setLocalError(null)
      setEditor((currentEditor) => (currentEditor ? { ...currentEditor, imageUrl: reader.result as string } : null))
    }
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    if (!editor) {
      return
    }
    const title = editor.title.trim()
    if (!title) {
      setLocalError('Укажите название места.')
      return
    }
    setLocalError(null)
    try {
      await onSave({
        id: editor.id,
        title,
        triggers: editorTriggers,
        imageUrl: editor.imageUrl,
      })
      setEditor(null)
    } catch (saveError) {
      setLocalError(getErrorMessage(saveError, 'Не удалось сохранить место.'))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) {
      return
    }
    setLocalError(null)
    try {
      await onDelete(deleteTarget.id)
      setDeleteTarget(null)
    } catch (deleteError) {
      setLocalError(getErrorMessage(deleteError, 'Не удалось удалить место.'))
    }
  }

  const handleImport = async (templateId: number) => {
    if (!onImport) {
      return
    }
    setLocalError(null)
    setPendingImportId(templateId)
    try {
      await onImport(templateId)
      setIsLibraryOpen(false)
    } catch (importError) {
      setLocalError(getErrorMessage(importError, 'Не удалось добавить место из библиотеки.'))
    } finally {
      setPendingImportId(null)
    }
  }

  return (
    <>
      <Stack spacing={1.25} sx={{ minWidth: 0, width: '100%' }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Stack spacing={0.3} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ color: 'var(--morius-accent)', display: 'flex' }}>
                <PanelIcon name="place" size={18} />
              </Box>
              <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1rem', fontWeight: 850 }}>
                Места
              </Typography>
            </Stack>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem', lineHeight: 1.45 }}>
              Фон сохраняется до перехода в другое место. Триггеры помогают рассказчику переключать сцену.
            </Typography>
          </Stack>
          {onRefresh ? (
            <Tooltip title="Обновить">
              <span>
                <IconButton
                  aria-label="Обновить места"
                  size="small"
                  disabled={isBusy || isRefreshing}
                  onClick={() => void runRefresh()}
                  sx={{ color: 'var(--morius-text-secondary)', mt: -0.35 }}
                >
                  {isRefreshing ? <CircularProgress size={17} color="inherit" /> : <PanelIcon name="refresh" size={18} />}
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7}>
          <Button
            fullWidth
            disabled={isBusy}
            onClick={() => void runGenerate(currentPlaceId ?? undefined)}
            startIcon={
              generating && (pendingGenerateId === null || pendingGenerateId === currentPlaceId) ? (
                <CircularProgress size={15} color="inherit" />
              ) : (
                <PanelIcon name="generate" size={17} />
              )
            }
            sx={{
              minHeight: 38,
              borderRadius: '12px',
              color: 'var(--morius-title-text)',
              border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 52%, var(--morius-card-border))',
              backgroundColor: 'color-mix(in srgb, var(--morius-accent) 14%, var(--morius-elevated-bg))',
              fontSize: '0.78rem',
              fontWeight: 800,
              whiteSpace: 'nowrap',
              '&:hover': {
                backgroundColor: 'color-mix(in srgb, var(--morius-accent) 22%, var(--morius-elevated-bg))',
              },
            }}
          >
            {currentPlaceId ? 'Перегенерировать фон' : 'Сгенерировать фон'}
          </Button>
          <Tooltip title="Добавить место">
            <span>
              <IconButton
                aria-label="Добавить место"
                disabled={isBusy}
                onClick={() => {
                  setLocalError(null)
                  setEditor(createEditorState(undefined, defaultImageModel, defaultStylePrompt))
                }}
                sx={{
                  width: { xs: '100%', sm: 38 },
                  height: 38,
                  borderRadius: '12px',
                  color: 'var(--morius-text-primary)',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                  backgroundColor: 'var(--morius-elevated-bg)',
                }}
              >
                <PanelIcon name="add" size={18} />
              </IconButton>
            </span>
          </Tooltip>
          {onImport ? (
            <Tooltip title="Добавить из библиотеки">
              <span>
                <IconButton
                  aria-label="Добавить место из библиотеки"
                  disabled={isBusy}
                  onClick={() => {
                    setLocalError(null)
                    setIsLibraryOpen(true)
                  }}
                  sx={{
                    width: { xs: '100%', sm: 38 },
                    height: 38,
                    borderRadius: '12px',
                    color: 'var(--morius-text-primary)',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-elevated-bg)',
                  }}
                >
                  <PanelIcon name="library" size={18} />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
        </Stack>

        {error || localError ? (
          <Alert
            severity="error"
            variant="outlined"
            sx={{
              py: 0.2,
              borderRadius: '12px',
              color: 'var(--morius-text-primary)',
              '& .MuiAlert-message': { minWidth: 0, fontSize: '0.76rem' },
            }}
          >
            {localError || error}
          </Alert>
        ) : null}

        {loading ? (
          <Stack spacing={0.9} aria-label="Загрузка мест">
            {[0, 1].map((index) => (
              <Box
                key={index}
                sx={{
                  overflow: 'hidden',
                  borderRadius: '14px',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                }}
              >
                <Skeleton variant="rectangular" height={116} animation="wave" />
                <Stack spacing={0.65} sx={{ p: 1 }}>
                  <Skeleton width="58%" height={22} />
                  <Skeleton width="82%" height={18} />
                </Stack>
              </Box>
            ))}
          </Stack>
        ) : places.length === 0 ? (
          <Stack
            alignItems="center"
            spacing={0.8}
            sx={{
              px: 1.2,
              py: 2.4,
              borderRadius: '14px',
              border: 'var(--morius-border-width) dashed var(--morius-card-border)',
              backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 72%, transparent)',
              textAlign: 'center',
            }}
          >
            <Box sx={{ color: 'var(--morius-text-secondary)', display: 'flex' }}>
              <PanelIcon name="place" size={28} />
            </Box>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.86rem', fontWeight: 800 }}>
              Мест пока нет
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.74rem', lineHeight: 1.45 }}>
              Сгенерируйте фон текущей сцены или добавьте подготовленное место.
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={0.9}>
            {places.map((place) => {
              const isCurrent = place.id === currentPlaceId || place.is_current
              const isSelecting = pendingSelectId === place.id
              const isGeneratingThisPlace = generating && pendingGenerateId === place.id
              return (
                <Box
                  key={place.id}
                  sx={{
                    overflow: 'hidden',
                    borderRadius: '14px',
                    border: `var(--morius-border-width) solid ${
                      isCurrent
                        ? 'color-mix(in srgb, var(--morius-accent) 64%, var(--morius-card-border))'
                        : 'var(--morius-card-border)'
                    }`,
                    backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 94%, #000 6%)',
                    boxShadow: isCurrent ? '0 12px 30px color-mix(in srgb, var(--morius-accent) 9%, transparent)' : 'none',
                  }}
                >
                  <Box sx={{ position: 'relative', aspectRatio: '16 / 8.5', overflow: 'hidden' }}>
                    <ProgressiveImage
                      src={place.image_url}
                      alt={`Фон места «${place.title}»`}
                      objectFit="cover"
                      containerSx={{ width: '100%', height: '100%' }}
                      fallback={<PlaceImageFallback compact />}
                    />
                    <Box
                      aria-hidden
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        background: 'linear-gradient(180deg, rgba(7, 9, 13, 0.08) 34%, rgba(7, 9, 13, 0.88) 100%)',
                        pointerEvents: 'none',
                      }}
                    />
                    {isCurrent ? (
                      <Chip
                        icon={<PanelIcon name="check" size={14} />}
                        label="Текущее место"
                        size="small"
                        sx={{
                          position: 'absolute',
                          top: 8,
                          left: 8,
                          height: 25,
                          color: 'var(--morius-title-text)',
                          backgroundColor: 'color-mix(in srgb, var(--morius-accent) 72%, rgba(10, 13, 18, 0.88))',
                          backdropFilter: 'blur(10px)',
                          fontSize: '0.68rem',
                          fontWeight: 850,
                          '& .MuiChip-icon': { color: 'inherit', ml: 0.65 },
                        }}
                      />
                    ) : null}
                    <Typography
                      sx={{
                        position: 'absolute',
                        left: 10,
                        right: 10,
                        bottom: 8,
                        color: '#fff',
                        fontSize: '0.92rem',
                        fontWeight: 850,
                        lineHeight: 1.25,
                        textShadow: '0 2px 12px rgba(0, 0, 0, 0.72)',
                      }}
                    >
                      {place.title}
                    </Typography>
                  </Box>

                  <Stack spacing={0.8} sx={{ p: 1 }}>
                    {place.triggers.length > 0 ? (
                      <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap">
                        {place.triggers.slice(0, 5).map((trigger) => (
                          <Chip
                            key={trigger}
                            label={trigger}
                            size="small"
                            sx={{
                              maxWidth: '100%',
                              height: 23,
                              color: 'var(--morius-text-secondary)',
                              border: 'var(--morius-border-width) solid var(--morius-card-border)',
                              backgroundColor: 'transparent',
                              fontSize: '0.66rem',
                              '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                            }}
                          />
                        ))}
                        {place.triggers.length > 5 ? (
                          <Chip
                            label={`+${place.triggers.length - 5}`}
                            size="small"
                            sx={{ height: 23, color: 'var(--morius-text-secondary)', fontSize: '0.66rem' }}
                          />
                        ) : null}
                      </Stack>
                    ) : (
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.7rem', fontStyle: 'italic' }}>
                        Без триггеров — место можно выбрать вручную
                      </Typography>
                    )}

                    <Stack direction="row" alignItems="center" spacing={0.45}>
                      {!isCurrent ? (
                        <Button
                          size="small"
                          disabled={isBusy || isSelecting}
                          onClick={() => void runSelect(place.id)}
                          startIcon={
                            isSelecting ? <CircularProgress size={13} color="inherit" /> : <PanelIcon name="check" size={15} />
                          }
                          sx={{
                            minWidth: 0,
                            flex: 1,
                            minHeight: 31,
                            borderRadius: '9px',
                            color: 'var(--morius-text-primary)',
                            border: 'var(--morius-border-width) solid var(--morius-card-border)',
                            fontSize: '0.7rem',
                            fontWeight: 800,
                          }}
                        >
                          Выбрать
                        </Button>
                      ) : null}
                      <Tooltip title="Перегенерировать фон">
                        <span>
                          <IconButton
                            aria-label={`Перегенерировать фон места «${place.title}»`}
                            size="small"
                            disabled={isBusy}
                            onClick={() => void runGenerate(place.id)}
                            sx={{
                              width: 31,
                              height: 31,
                              borderRadius: '9px',
                              color: 'var(--morius-text-primary)',
                              border: 'var(--morius-border-width) solid var(--morius-card-border)',
                            }}
                          >
                            {isGeneratingThisPlace ? (
                              <CircularProgress size={14} color="inherit" />
                            ) : (
                              <PanelIcon name="generate" size={16} />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Редактировать">
                        <span>
                          <IconButton
                            aria-label={`Редактировать место «${place.title}»`}
                            size="small"
                            disabled={isBusy}
                            onClick={() => {
                              setLocalError(null)
                              setEditor(createEditorState(place, defaultImageModel, defaultStylePrompt))
                            }}
                            sx={{
                              width: 31,
                              height: 31,
                              borderRadius: '9px',
                              color: 'var(--morius-text-secondary)',
                              border: 'var(--morius-border-width) solid var(--morius-card-border)',
                            }}
                          >
                            <PanelIcon name="edit" size={16} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Удалить">
                        <span>
                          <IconButton
                            aria-label={`Удалить место «${place.title}»`}
                            size="small"
                            disabled={isBusy}
                            onClick={() => {
                              setLocalError(null)
                              setDeleteTarget(place)
                            }}
                            sx={{
                              width: 31,
                              height: 31,
                              borderRadius: '9px',
                              color: 'var(--morius-text-secondary)',
                              border: 'var(--morius-border-width) solid var(--morius-card-border)',
                              '&:hover': { color: '#ef8d8d' },
                            }}
                          >
                            <PanelIcon name="delete" size={16} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </Stack>
                </Box>
              )
            })}
          </Stack>
        )}
      </Stack>

      <BaseDialog
        open={editor !== null}
        onClose={() => setEditor(null)}
        maxWidth="sm"
        hasUnsavedChanges={editorHasChanges}
        header={
          <Stack spacing={0.35}>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.12rem', fontWeight: 850 }}>
              {editor?.id ? 'Редактировать место' : 'Новое место'}
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', lineHeight: 1.45 }}>
              Добавьте фон и слова, при которых рассказчик должен переключить сцену.
            </Typography>
          </Stack>
        }
        actions={
          <Stack direction="row" spacing={0.8} justifyContent="flex-end" sx={{ width: '100%' }}>
            <Button disabled={saving} onClick={() => setEditor(null)} sx={{ color: 'var(--morius-text-secondary)' }}>
              Отмена
            </Button>
            <Button
              disabled={saving || !editor?.title.trim()}
              onClick={() => void handleSave()}
              startIcon={saving ? <CircularProgress size={15} color="inherit" /> : <PanelIcon name="check" size={17} />}
              sx={{ color: 'var(--morius-title-text)', fontWeight: 800 }}
            >
              {saving ? 'Сохраняем...' : 'Сохранить'}
            </Button>
          </Stack>
        }
      >
        <Stack spacing={1.45}>
          <Box
            sx={{
              position: 'relative',
              overflow: 'hidden',
              width: '100%',
              aspectRatio: '16 / 8.5',
              borderRadius: '14px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
            }}
          >
            <ProgressiveImage
              src={editor?.imageUrl}
              alt="Предпросмотр фона места"
              objectFit="cover"
              containerSx={{ width: '100%', height: '100%' }}
              fallback={<PlaceImageFallback />}
            />
            <Stack
              direction="row"
              spacing={0.65}
              sx={{ position: 'absolute', right: 10, bottom: 10 }}
            >
              <Tooltip title="Сгенерировать фон за солы">
                <span>
                  <IconButton
                    aria-label="Сгенерировать фон места"
                    disabled={isBusy || !editor?.title.trim() || !editor?.description.trim()}
                    onClick={() => void handleGenerateEditorBackground()}
                    sx={{
                      width: 34,
                      height: 34,
                      borderRadius: '10px',
                      color: '#fff',
                      backgroundColor: 'rgba(12, 14, 18, 0.78)',
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    {generating && pendingGenerateId === (editor?.id ?? null) ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <PanelIcon name="generate" size={18} />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
              {editor?.imageUrl ? (
                <Button
                  size="small"
                  disabled={saving}
                  onClick={() => setEditor((currentEditor) => (currentEditor ? { ...currentEditor, imageUrl: null } : null))}
                  sx={{
                    minHeight: 32,
                    borderRadius: '10px',
                    color: '#fff',
                    backgroundColor: 'rgba(12, 14, 18, 0.78)',
                    backdropFilter: 'blur(12px)',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                  }}
                >
                  Удалить
                </Button>
              ) : null}
              <Button
                size="small"
                disabled={saving}
                onClick={() => fileInputRef.current?.click()}
                startIcon={<PanelIcon name="image" size={16} />}
                sx={{
                  minHeight: 32,
                  borderRadius: '10px',
                  color: '#fff',
                  backgroundColor: 'rgba(12, 14, 18, 0.78)',
                  backdropFilter: 'blur(12px)',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                }}
              >
                {editor?.imageUrl ? 'Заменить' : 'Загрузить фон'}
              </Button>
            </Stack>
          </Box>
          <Box
            ref={fileInputRef}
            component="input"
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            sx={{ display: 'none' }}
          />

          <TextField
            autoFocus
            fullWidth
            label="Название места"
            value={editor?.title ?? ''}
            disabled={saving}
            placeholder="Например, Дом Айри"
            inputProps={{ maxLength: 160 }}
            onChange={(event) =>
              setEditor((currentEditor) => (currentEditor ? { ...currentEditor, title: event.target.value } : null))
            }
          />

          <TextField
            fullWidth
            multiline
            minRows={3}
            maxRows={7}
            label="Что сгенерировать"
            value={editor?.description ?? ''}
            disabled={isBusy}
            placeholder="Например, богатый кабинет аристократа с тёмным деревом, гербами и видом на зимний город"
            inputProps={{ maxLength: 4000 }}
            helperText="Опишите только место и атмосферу — персонажи на фон не попадут."
            onChange={(event) =>
              setEditor((currentEditor) =>
                currentEditor ? { ...currentEditor, description: event.target.value } : null,
              )
            }
          />

          <TextField
            fullWidth
            label="Стиль"
            value={editor?.stylePrompt ?? ''}
            disabled={isBusy}
            placeholder="Например, cinematic anime background, painterly lighting"
            inputProps={{ maxLength: 1000 }}
            onChange={(event) =>
              setEditor((currentEditor) =>
                currentEditor ? { ...currentEditor, stylePrompt: event.target.value } : null,
              )
            }
          />

          <TextField
            select
            fullWidth
            label="Модель генерации"
            value={editor?.imageModel ?? defaultImageModel}
            disabled={isBusy}
            onChange={(event) =>
              setEditor((currentEditor) =>
                currentEditor
                  ? { ...currentEditor, imageModel: event.target.value as StoryImageModelId }
                  : null,
              )
            }
          >
            {STORY_IMAGE_MODEL_OPTIONS_SHARED.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.title} · {option.cost} сол
              </MenuItem>
            ))}
          </TextField>

          <Stack spacing={0.75}>
            <TextField
              fullWidth
              multiline
              minRows={3}
              maxRows={7}
              label="Триггеры активации"
              value={editor?.triggersText ?? ''}
              disabled={saving}
              placeholder={'Дом Айри\nособняк Айри\nвернуться домой'}
              helperText="Один триггер на строку. Можно разделять запятыми. Регистр не важен."
              onChange={(event) =>
                setEditor((currentEditor) =>
                  currentEditor ? { ...currentEditor, triggersText: event.target.value } : null,
                )
              }
            />
            {editorTriggers.length > 0 ? (
              <Stack direction="row" spacing={0.55} useFlexGap flexWrap="wrap">
                {editorTriggers.map((trigger) => (
                  <Chip
                    key={trigger}
                    label={trigger}
                    onDelete={
                      saving
                        ? undefined
                        : () => {
                            const nextTriggers = editorTriggers.filter((currentTrigger) => currentTrigger !== trigger)
                            setEditor((currentEditor) =>
                              currentEditor ? { ...currentEditor, triggersText: formatTriggers(nextTriggers) } : null,
                            )
                          }
                    }
                    size="small"
                    sx={{
                      maxWidth: '100%',
                      color: 'var(--morius-text-primary)',
                      border: 'var(--morius-border-width) solid var(--morius-card-border)',
                      backgroundColor: 'var(--morius-elevated-bg)',
                    }}
                  />
                ))}
              </Stack>
            ) : null}
          </Stack>

          {localError ? <Alert severity="error">{localError}</Alert> : null}
        </Stack>
      </BaseDialog>

      <BaseDialog
        open={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        maxWidth="md"
        protectTextInputClose={false}
        header={
          <Stack spacing={0.35}>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.12rem', fontWeight: 850 }}>
              Добавить место из библиотеки
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem' }}>
              В игру копируются фон и триггеры. После импорта их можно менять независимо от шаблона.
            </Typography>
          </Stack>
        }
      >
        {profileTemplates.length === 0 ? (
          <Stack alignItems="center" spacing={0.8} sx={{ py: 4, textAlign: 'center' }}>
            <Box sx={{ color: 'var(--morius-text-secondary)', display: 'flex' }}>
              <PanelIcon name="library" size={32} />
            </Box>
            <Typography sx={{ color: 'var(--morius-title-text)', fontWeight: 800 }}>Библиотека пока пуста</Typography>
            <Typography sx={{ maxWidth: 420, color: 'var(--morius-text-secondary)', fontSize: '0.82rem', lineHeight: 1.5 }}>
              Подготовленные места можно создать во вкладке «Места» в профиле администратора.
            </Typography>
          </Stack>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
              gap: 1.15,
            }}
          >
            {profileTemplates.map((template) => {
              const isImporting = pendingImportId === template.id
              return (
                <Box
                  key={template.id}
                  sx={{
                    minWidth: 0,
                    overflow: 'hidden',
                    borderRadius: '14px',
                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                    backgroundColor: 'var(--morius-card-bg)',
                  }}
                >
                  <Box sx={{ aspectRatio: '16 / 8.5' }}>
                    <ProgressiveImage
                      src={template.image_url}
                      alt={`Фон места «${template.title}»`}
                      objectFit="cover"
                      containerSx={{ width: '100%', height: '100%' }}
                      fallback={<PlaceImageFallback compact />}
                    />
                  </Box>
                  <Stack spacing={0.75} sx={{ p: 1.1 }}>
                    <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.9rem', fontWeight: 850 }}>
                      {template.title}
                    </Typography>
                    {template.triggers.length > 0 ? (
                      <Typography
                        sx={{
                          color: 'var(--morius-text-secondary)',
                          fontSize: '0.7rem',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {template.triggers.join(' · ')}
                      </Typography>
                    ) : (
                      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.7rem', fontStyle: 'italic' }}>
                        Без триггеров
                      </Typography>
                    )}
                    <Button
                      fullWidth
                      disabled={isBusy || pendingImportId !== null}
                      onClick={() => void handleImport(template.id)}
                      startIcon={
                        isImporting ? <CircularProgress size={14} color="inherit" /> : <PanelIcon name="add" size={16} />
                      }
                      sx={{
                        minHeight: 34,
                        borderRadius: '10px',
                        color: 'var(--morius-title-text)',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        fontSize: '0.74rem',
                        fontWeight: 800,
                      }}
                    >
                      Добавить в игру
                    </Button>
                  </Stack>
                </Box>
              )
            })}
          </Box>
        )}
        {localError ? <Alert severity="error" sx={{ mt: 1.2 }}>{localError}</Alert> : null}
      </BaseDialog>

      <BaseDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        maxWidth="xs"
        protectTextInputClose={false}
        header={
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.08rem', fontWeight: 850 }}>
            Удалить место?
          </Typography>
        }
        actions={
          <Stack direction="row" spacing={0.8} justifyContent="flex-end" sx={{ width: '100%' }}>
            <Button disabled={saving} onClick={() => setDeleteTarget(null)} sx={{ color: 'var(--morius-text-secondary)' }}>
              Отмена
            </Button>
            <Button
              disabled={saving}
              onClick={() => void handleDelete()}
              startIcon={saving ? <CircularProgress size={15} color="inherit" /> : <PanelIcon name="delete" size={17} />}
              sx={{ color: '#ef8d8d', fontWeight: 800 }}
            >
              {saving ? 'Удаляем...' : 'Удалить'}
            </Button>
          </Stack>
        }
      >
        <Stack spacing={1}>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.86rem', lineHeight: 1.5 }}>
            «{deleteTarget?.title}» исчезнет из этой игры. Если оно сохранено в библиотеке профиля, шаблон останется там.
          </Typography>
          {deleteTarget?.id === currentPlaceId ? (
            <Alert severity="warning" variant="outlined">
              Это текущий фон сцены. После удаления останется базовый градиент, пока не будет выбрано другое место.
            </Alert>
          ) : null}
          {localError ? <Alert severity="error">{localError}</Alert> : null}
        </Stack>
      </BaseDialog>
    </>
  )
}

export default NovelPlacesPanel
