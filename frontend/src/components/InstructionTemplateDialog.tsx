import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import BaseDialog from './dialogs/BaseDialog'
import {
  createStoryInstructionTemplate,
  deleteStoryInstructionTemplate,
  listStoryInstructionTemplates,
  updateStoryInstructionTemplate,
} from '../services/storyApi'
import type { StoryInstructionTemplate } from '../types/story'

const TEMPLATE_TITLE_MAX_LENGTH = 120
const TEMPLATE_CONTENT_MAX_LENGTH = 8000

export type InstructionTemplateDialogMode = 'manage' | 'picker'

type InstructionTemplateDialogProps = {
  open: boolean
  authToken: string
  mode: InstructionTemplateDialogMode
  onClose: () => void
  onSelectTemplate?: (template: StoryInstructionTemplate) => Promise<void> | void
}

function InstructionTemplateDialog({
  open,
  authToken,
  mode,
  onClose,
  onSelectTemplate,
}: InstructionTemplateDialogProps) {
  const [templates, setTemplates] = useState<StoryInstructionTemplate[]>([])
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null)
  const [templateTitleDraft, setTemplateTitleDraft] = useState('')
  const [templateContentDraft, setTemplateContentDraft] = useState('')
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(null)
  const [applyingTemplateId, setApplyingTemplateId] = useState<number | null>(null)

  const isBusy = isSavingTemplate || deletingTemplateId !== null || applyingTemplateId !== null

  const loadTemplates = useCallback(async () => {
    setIsLoadingTemplates(true)
    setErrorMessage('')
    try {
      const items = await listStoryInstructionTemplates(authToken)
      const normalizedItems = items
        .filter((item): item is StoryInstructionTemplate => Boolean(item) && typeof item.id === 'number')
        .map((item) => ({
          ...item,
          title: typeof item.title === 'string' ? item.title : '',
          content: typeof item.content === 'string' ? item.content : '',
        }))
      setTemplates(normalizedItems)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось загрузить шаблоны'
      setErrorMessage(detail)
      setTemplates([])
    } finally {
      setIsLoadingTemplates(false)
    }
  }, [authToken])

  useEffect(() => {
    if (!open) {
      setIsEditorOpen(false)
      setEditingTemplateId(null)
      setTemplateTitleDraft('')
      setTemplateContentDraft('')
      setErrorMessage('')
      setIsSavingTemplate(false)
      setDeletingTemplateId(null)
      setApplyingTemplateId(null)
      return
    }
    void loadTemplates()
  }, [loadTemplates, open])

  const sortedTemplates = useMemo(
    () =>
      templates
        .filter((item): item is StoryInstructionTemplate => Boolean(item) && typeof item.id === 'number')
        .sort((left, right) => left.id - right.id),
    [templates],
  )

  const handleCloseDialog = () => {
    if (isBusy) {
      return
    }
    onClose()
  }

  const handleOpenCreateEditor = () => {
    if (isBusy) {
      return
    }
    setErrorMessage('')
    setEditingTemplateId(null)
    setTemplateTitleDraft('')
    setTemplateContentDraft('')
    setIsEditorOpen(true)
  }

  const handleOpenEditEditor = (template: StoryInstructionTemplate) => {
    if (isBusy) {
      return
    }
    setErrorMessage('')
    setEditingTemplateId(template.id)
    setTemplateTitleDraft(template.title)
    setTemplateContentDraft(template.content)
    setIsEditorOpen(true)
  }

  const handleCloseEditor = () => {
    if (isBusy) {
      return
    }
    setIsEditorOpen(false)
    setEditingTemplateId(null)
    setTemplateTitleDraft('')
    setTemplateContentDraft('')
  }

  const handleSaveTemplate = useCallback(async () => {
    if (isBusy) {
      return
    }

    const normalizedTitle = templateTitleDraft.replace(/\s+/g, ' ').trim()
    const normalizedContent = templateContentDraft.replace(/\r\n/g, '\n').trim()
    if (!normalizedTitle) {
      setErrorMessage('Введите заголовок шаблона')
      return
    }
    if (!normalizedContent) {
      setErrorMessage('Введите текст инструкции')
      return
    }

    setErrorMessage('')
    setIsSavingTemplate(true)
    try {
      if (editingTemplateId === null) {
        await createStoryInstructionTemplate({
          token: authToken,
          title: normalizedTitle,
          content: normalizedContent,
        })
      } else {
        await updateStoryInstructionTemplate({
          token: authToken,
          templateId: editingTemplateId,
          title: normalizedTitle,
          content: normalizedContent,
        })
      }
      await loadTemplates()
      setIsEditorOpen(false)
      setEditingTemplateId(null)
      setTemplateTitleDraft('')
      setTemplateContentDraft('')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось сохранить шаблон'
      setErrorMessage(detail)
    } finally {
      setIsSavingTemplate(false)
    }
  }, [authToken, editingTemplateId, isBusy, loadTemplates, templateContentDraft, templateTitleDraft])

  const handleDeleteTemplate = useCallback(
    async (templateId: number) => {
      if (isBusy) {
        return
      }
      setErrorMessage('')
      setDeletingTemplateId(templateId)
      try {
        await deleteStoryInstructionTemplate({
          token: authToken,
          templateId,
        })
        await loadTemplates()
        if (editingTemplateId === templateId) {
          setIsEditorOpen(false)
          setEditingTemplateId(null)
          setTemplateTitleDraft('')
          setTemplateContentDraft('')
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось удалить шаблон'
        setErrorMessage(detail)
      } finally {
        setDeletingTemplateId(null)
      }
    },
    [authToken, editingTemplateId, isBusy, loadTemplates],
  )

  const handleApplyTemplate = useCallback(
    async (template: StoryInstructionTemplate) => {
      if (!onSelectTemplate || isBusy) {
        return
      }
      setErrorMessage('')
      setApplyingTemplateId(template.id)
      try {
        await onSelectTemplate(template)
        onClose()
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Не удалось применить шаблон'
        setErrorMessage(detail)
      } finally {
        setApplyingTemplateId(null)
      }
    },
    [isBusy, onClose, onSelectTemplate],
  )

  return (
    <>
      <BaseDialog
        open={open}
        onClose={handleCloseDialog}
        maxWidth="sm"
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 0.9 }}>
          <Stack spacing={0.35}>
            <Typography sx={{ fontWeight: 700, fontSize: '1.45rem' }}>
              {mode === 'manage' ? 'Мои инструкции' : 'Шаблоны инструкций'}
            </Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>
              {mode === 'manage'
                ? 'Сохраненные шаблоны можно использовать в любой игре и при создании мира.'
                : 'Выберите готовый шаблон или создайте новый прямо здесь.'}
            </Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.35 }}>
          <Stack spacing={1.05}>
            {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

            <Button
              onClick={handleOpenCreateEditor}
              disabled={isBusy}
              sx={{
                minHeight: 40,
                borderRadius: '12px',
                textTransform: 'none',
                color: 'var(--morius-text-primary)',
                border: 'var(--morius-border-width) dashed var(--morius-card-border)',
                backgroundColor: 'var(--morius-elevated-bg)',
              }}
            >
              Создать шаблон
            </Button>

            {isLoadingTemplates ? (
              <Stack alignItems="center" justifyContent="center" sx={{ py: 2.2 }}>
                <CircularProgress size={24} />
              </Stack>
            ) : sortedTemplates.length === 0 ? (
              <Box
                sx={{
                  borderRadius: '12px',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                  backgroundColor: 'var(--morius-elevated-bg)',
                  px: 1.1,
                  py: 1.05,
                }}
              >
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>
                  Пока нет сохраненных шаблонов.
                </Typography>
              </Box>
            ) : (
              <Box className="morius-scrollbar" sx={{ maxHeight: 352, overflowY: 'auto', pr: 0.25 }}>
                <Stack spacing={0.75}>
                  {sortedTemplates.map((template) => (
                    <Box
                      key={template.id}
                      sx={{
                        borderRadius: '12px',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        backgroundColor: 'var(--morius-elevated-bg)',
                        px: 1.05,
                        py: 0.9,
                      }}
                    >
                      <Typography
                        sx={{
                          color: 'var(--morius-text-primary)',
                          fontSize: '0.95rem',
                          fontWeight: 700,
                          lineHeight: 1.25,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {template.title}
                      </Typography>
                      <Typography
                        sx={{
                          mt: 0.45,
                          color: 'var(--morius-text-secondary)',
                          fontSize: '0.85rem',
                          lineHeight: 1.4,
                          whiteSpace: 'pre-wrap',
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {template.content}
                      </Typography>
                      <Stack direction="row" spacing={0.65} sx={{ mt: 0.85 }}>
                        {mode === 'picker' ? (
                          <Button
                            onClick={() => void handleApplyTemplate(template)}
                            disabled={isBusy || !onSelectTemplate}
                            sx={{
                              minHeight: 30,
                              px: 1.05,
                              textTransform: 'none',
                              border: 'var(--morius-border-width) solid var(--morius-card-border)',
                              backgroundColor: 'var(--morius-button-active)',
                              color: 'var(--morius-text-primary)',
                              '&:hover': {
                                backgroundColor: 'var(--morius-button-hover)',
                              },
                            }}
                          >
                            {applyingTemplateId === template.id ? (
                              <CircularProgress size={14} sx={{ color: 'var(--morius-text-primary)' }} />
                            ) : (
                              'Применить'
                            )}
                          </Button>
                        ) : null}
                        <Button
                          onClick={() => handleOpenEditEditor(template)}
                          disabled={isBusy}
                          sx={{ minHeight: 30, px: 1.05, textTransform: 'none' }}
                        >
                          Изменить
                        </Button>
                        <Button
                          onClick={() => void handleDeleteTemplate(template.id)}
                          disabled={isBusy}
                          sx={{ minHeight: 30, px: 1.05, textTransform: 'none', color: 'var(--morius-text-secondary)' }}
                        >
                          {deletingTemplateId === template.id ? (
                            <CircularProgress size={14} sx={{ color: 'var(--morius-text-secondary)' }} />
                          ) : (
                            'Удалить'
                          )}
                        </Button>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={handleCloseDialog} disabled={isBusy} sx={{ color: 'var(--morius-text-secondary)' }}>
            Закрыть
          </Button>
        </DialogActions>
      </BaseDialog>

      <BaseDialog
        open={open && isEditorOpen}
        onClose={handleCloseEditor}
        maxWidth="sm"
        paperSx={{
          borderRadius: 'var(--morius-radius)',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
        }}
        rawChildren
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
            {editingTemplateId === null ? 'Новый шаблон' : 'Редактирование шаблона'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.35 }}>
          <Stack spacing={1}>
            <Box
              component="input"
              value={templateTitleDraft}
              placeholder="Заголовок шаблона"
              maxLength={TEMPLATE_TITLE_MAX_LENGTH}
              autoFocus
              onChange={(event: ChangeEvent<HTMLInputElement>) => setTemplateTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSaveTemplate()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 42,
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.26)',
                backgroundColor: 'var(--morius-card-bg)',
                color: '#dfe6f2',
                px: 1.1,
                outline: 'none',
                fontSize: '0.96rem',
              }}
            />
            <Box
              component="textarea"
              value={templateContentDraft}
              placeholder="Текст инструкции"
              maxLength={TEMPLATE_CONTENT_MAX_LENGTH}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setTemplateContentDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void handleSaveTemplate()
                }
              }}
              sx={{
                width: '100%',
                minHeight: 150,
                resize: 'vertical',
                borderRadius: 'var(--morius-radius)',
                border: 'var(--morius-border-width) solid rgba(186, 202, 214, 0.22)',
                backgroundColor: 'var(--morius-card-bg)',
                color: '#dbe2ee',
                px: 1.1,
                py: 0.9,
                outline: 'none',
                fontSize: '0.96rem',
                lineHeight: 1.45,
                fontFamily: '"Nunito Sans", "Segoe UI", sans-serif',
              }}
            />
            <Typography sx={{ color: 'rgba(190, 202, 220, 0.62)', fontSize: '0.8rem', textAlign: 'right' }}>
              {templateContentDraft.length}/{TEMPLATE_CONTENT_MAX_LENGTH}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={handleCloseEditor} disabled={isSavingTemplate} sx={{ color: 'var(--morius-text-secondary)' }}>
            Отмена
          </Button>
          <Button
            onClick={() => void handleSaveTemplate()}
            disabled={isSavingTemplate}
            sx={{
              minWidth: 118,
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-button-active)',
              color: 'var(--morius-text-primary)',
              '&:hover': { backgroundColor: 'var(--morius-button-hover)' },
            }}
          >
            {isSavingTemplate ? (
              <CircularProgress size={15} sx={{ color: 'var(--morius-text-primary)' }} />
            ) : editingTemplateId === null ? (
              'Сохранить'
            ) : (
              'Обновить'
            )}
          </Button>
        </DialogActions>
      </BaseDialog>
    </>
  )
}

export default InstructionTemplateDialog
