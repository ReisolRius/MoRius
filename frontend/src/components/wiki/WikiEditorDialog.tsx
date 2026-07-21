import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { compressImageFileToDataUrl, getJsonDataUrlRequestSafeMaxBytes } from '../../utils/avatar'
import {
  createWikiArticle,
  updateWikiArticle,
  type WikiArticleDetail,
  type WikiArticleImagePayload,
} from '../../services/wikiApi'
import WikiMarkup from './WikiMarkup'

const IMAGE_MAX_BYTES = 2_500_000
const IMAGE_MAX_DIMENSION = 1600
const PLACEHOLDER_RE = /\[\[image:([^\]\n]+)\]\]/g

type WikiEditorImage = {
  key: string
  imageId: number | null
  dataUrl: string | null
  url: string | null
}

type WikiEditorDialogProps = {
  open: boolean
  token: string
  initial: WikiArticleDetail | null
  onClose: () => void
  onSaved: (detail: WikiArticleDetail) => void
}

function extractBodyKeys(body: string): Set<string> {
  const keys = new Set<string>()
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    const key = match[1].trim()
    if (key) {
      keys.add(key)
    }
  }
  return keys
}

export default function WikiEditorDialog({ open, token, initial, onClose, onSaved }: WikiEditorDialogProps) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [images, setImages] = useState<WikiEditorImage[]>([])
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    setTitle(initial?.title ?? '')
    setCategory(initial?.category ?? '')
    setSummary(initial?.summary ?? '')
    setBody(initial?.body ?? '')
    setImages(
      (initial?.images ?? []).map((image) => ({
        key: String(image.id),
        imageId: image.id,
        dataUrl: null,
        url: image.url,
      })),
    )
    setMode('edit')
    setError(null)
    setSaving(false)
    setUploading(false)
  }, [open, initial])

  const previewImages = useMemo(() => {
    const map = new Map<string, string>()
    for (const image of images) {
      const src = image.dataUrl ?? image.url
      if (src) {
        map.set(image.key, src)
      }
    }
    return map
  }, [images])

  const focusBody = (caretPosition: number) => {
    window.setTimeout(() => {
      const element = bodyRef.current
      if (!element) {
        return
      }
      element.focus()
      element.selectionStart = caretPosition
      element.selectionEnd = caretPosition
    }, 0)
  }

  const wrapSelection = (before: string, after: string, placeholder: string) => {
    const element = bodyRef.current
    const start = element?.selectionStart ?? body.length
    const end = element?.selectionEnd ?? body.length
    const selected = body.slice(start, end) || placeholder
    const next = `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`
    setBody(next)
    focusBody(start + before.length + selected.length + after.length)
  }

  const prefixLine = (prefix: string) => {
    const element = bodyRef.current
    const start = element?.selectionStart ?? body.length
    const lineStart = body.lastIndexOf('\n', start - 1) + 1
    const next = `${body.slice(0, lineStart)}${prefix}${body.slice(lineStart)}`
    setBody(next)
    focusBody(start + prefix.length)
  }

  const insertAtCursor = (text: string) => {
    const element = bodyRef.current
    const start = element?.selectionStart ?? body.length
    const end = element?.selectionEnd ?? body.length
    const next = `${body.slice(0, start)}${text}${body.slice(end)}`
    setBody(next)
    focusBody(start + text.length)
  }

  const handleImageFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return
    }
    setError(null)
    setUploading(true)
    try {
      const newImages: WikiEditorImage[] = []
      let placeholders = ''
      for (const file of Array.from(fileList)) {
        if (!file.type.startsWith('image/')) {
          continue
        }
        const dataUrl = await compressImageFileToDataUrl(file, {
          maxBytes: getJsonDataUrlRequestSafeMaxBytes(IMAGE_MAX_BYTES),
          maxDimension: IMAGE_MAX_DIMENSION,
        })
        const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        newImages.push({ key, imageId: null, dataUrl, url: null })
        placeholders += `\n\n[[image:${key}]]`
      }
      if (newImages.length === 0) {
        return
      }
      placeholders += '\n\n'
      setImages((previous) => [...previous, ...newImages])
      insertAtCursor(placeholders)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Не удалось обработать изображение')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const removeImage = (key: string) => {
    setImages((previous) => previous.filter((image) => image.key !== key))
    setBody((previous) => previous.replace(new RegExp(`\\n*\\[\\[image:${key}\\]\\]\\n*`, 'g'), '\n\n').trim())
  }

  const handleSave = async () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('Введите заголовок статьи')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const referencedKeys = extractBodyKeys(body)
      const payloadImages: WikiArticleImagePayload[] = images
        .filter((image) => referencedKeys.has(image.key))
        .map((image) =>
          image.dataUrl
            ? { key: image.key, data_url: image.dataUrl }
            : { key: image.key, image_id: image.imageId },
        )

      const articlePayload = {
        title: trimmedTitle,
        category: category.trim(),
        summary: summary.trim(),
        body,
        images: payloadImages,
      }

      const saved = initial
        ? await updateWikiArticle({ token, articleId: initial.id, article: articlePayload })
        : await createWikiArticle({ token, article: articlePayload })
      onSaved(saved)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить статью')
    } finally {
      setSaving(false)
    }
  }

  const toolbarButtonSx = {
    minHeight: 34,
    px: 1.2,
    borderRadius: '9px',
    textTransform: 'none' as const,
    fontSize: '0.82rem',
    fontWeight: 600,
    color: 'var(--morius-title-text)',
    border: 'var(--morius-border-width) solid var(--morius-card-border)',
    backgroundColor: 'var(--morius-elevated-bg)',
    '&:hover': {
      backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 82%, var(--morius-accent) 18%)',
    },
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{
        sx: {
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          backgroundImage: 'none',
          backgroundColor: 'var(--morius-card-bg)',
          color: 'var(--morius-text-primary)',
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 800, color: 'var(--morius-title-text)' }}>
        {initial ? 'Редактировать статью' : 'Новая статья'}
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: 'var(--morius-card-border)' }}>
        <Stack spacing={2}>
          {error ? (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}

          <TextField
            label="Заголовок"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            fullWidth
            required
            inputProps={{ maxLength: 200 }}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Раздел (необязательно)"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              fullWidth
              placeholder="Например: Начало игры"
              inputProps={{ maxLength: 80 }}
            />
          </Stack>
          <TextField
            label="Краткое описание (для списка и поиска)"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            fullWidth
            multiline
            minRows={2}
            inputProps={{ maxLength: 600 }}
          />

          <Divider sx={{ borderColor: 'var(--morius-card-border)' }} />

          <Tabs
            value={mode}
            onChange={(_event, value) => setMode(value as 'edit' | 'preview')}
            sx={{ minHeight: 38, '& .MuiTab-root': { minHeight: 38, textTransform: 'none', fontWeight: 700 } }}
          >
            <Tab value="edit" label="Редактор" />
            <Tab value="preview" label="Предпросмотр" />
          </Tabs>

          {mode === 'edit' ? (
            <Stack spacing={1.2}>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Button sx={toolbarButtonSx} onClick={() => wrapSelection('**', '**', 'жирный текст')}>
                  Жирный
                </Button>
                <Button sx={toolbarButtonSx} onClick={() => wrapSelection('*', '*', 'курсив')}>
                  Курсив
                </Button>
                <Button sx={toolbarButtonSx} onClick={() => prefixLine('## ')}>
                  Заголовок
                </Button>
                <Button sx={toolbarButtonSx} onClick={() => prefixLine('### ')}>
                  Подзаголовок
                </Button>
                <Button sx={toolbarButtonSx} onClick={() => prefixLine('- ')}>
                  Список
                </Button>
                <Button sx={toolbarButtonSx} onClick={() => prefixLine('> ')}>
                  Цитата
                </Button>
                <Button
                  sx={toolbarButtonSx}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  startIcon={uploading ? <CircularProgress size={14} color="inherit" /> : undefined}
                >
                  Фото
                </Button>
              </Stack>

              <TextField
                inputRef={bodyRef}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                fullWidth
                multiline
                minRows={12}
                placeholder={
                  'Пишите текст статьи здесь.\n\n## Заголовок раздела\nОбычный текст, **жирный**, *курсив*.\n\n- пункт списка\n\nНажмите «Фото», чтобы вставить изображение.'
                }
                InputProps={{ sx: { fontFamily: 'inherit', fontSize: '0.95rem', lineHeight: 1.6, alignItems: 'flex-start' } }}
              />
              <Typography sx={{ fontSize: '0.78rem', color: 'var(--morius-muted-text)' }}>
                Форматирование: **жирный**, *курсив*, «## Заголовок», «- список», «&gt; цитата». Изображения
                вставляются кнопкой «Фото».
              </Typography>

              {images.length > 0 ? (
                <Box>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, mb: 0.8, color: 'var(--morius-title-text)' }}>
                    Прикреплённые изображения
                  </Typography>
                  <Stack direction="row" spacing={1.2} useFlexGap flexWrap="wrap">
                    {images.map((image) => {
                      const src = image.dataUrl ?? image.url
                      if (!src) {
                        return null
                      }
                      const isReferenced = body.includes(`[[image:${image.key}]]`)
                      return (
                        <Box
                          key={image.key}
                          sx={{
                            position: 'relative',
                            width: 96,
                            height: 96,
                            borderRadius: '10px',
                            overflow: 'hidden',
                            border: 'var(--morius-border-width) solid var(--morius-card-border)',
                            opacity: isReferenced ? 1 : 0.5,
                          }}
                        >
                          <Box component="img" src={src} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <Stack
                            direction="row"
                            spacing={0.5}
                            sx={{ position: 'absolute', bottom: 4, left: 4, right: 4, justifyContent: 'space-between' }}
                          >
                            {!isReferenced ? (
                              <Button
                                size="small"
                                onClick={() => insertAtCursor(`\n\n[[image:${image.key}]]\n\n`)}
                                sx={{
                                  minWidth: 0,
                                  px: 0.8,
                                  fontSize: '0.68rem',
                                  color: '#fff',
                                  backgroundColor: 'rgba(0,0,0,0.6)',
                                  textTransform: 'none',
                                }}
                              >
                                Вставить
                              </Button>
                            ) : (
                              <span />
                            )}
                            <Button
                              size="small"
                              onClick={() => removeImage(image.key)}
                              sx={{
                                minWidth: 0,
                                px: 0.8,
                                fontSize: '0.68rem',
                                color: '#fff',
                                backgroundColor: 'rgba(180,40,40,0.72)',
                                textTransform: 'none',
                              }}
                            >
                              Удалить
                            </Button>
                          </Stack>
                        </Box>
                      )
                    })}
                  </Stack>
                </Box>
              ) : null}
            </Stack>
          ) : (
            <Box
              sx={{
                minHeight: 200,
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                background: 'var(--morius-app-bg)',
                p: 2,
              }}
            >
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, mb: 1, color: 'var(--morius-title-text)' }}>
                {title.trim() || 'Заголовок статьи'}
              </Typography>
              {body.trim() ? (
                <WikiMarkup body={body} images={previewImages} />
              ) : (
                <Typography sx={{ color: 'var(--morius-muted-text)' }}>Здесь появится предпросмотр статьи.</Typography>
              )}
            </Box>
          )}
        </Stack>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void handleImageFiles(event.target.files)
          }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: 'none', color: 'var(--morius-text-secondary)' }}>
          Отмена
        </Button>
        <Button
          onClick={() => void handleSave()}
          disabled={saving}
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{
            textTransform: 'none',
            fontWeight: 700,
            px: 2.4,
            backgroundColor: 'var(--morius-accent)',
            '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-accent) 86%, #000 14%)' },
          }}
        >
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
