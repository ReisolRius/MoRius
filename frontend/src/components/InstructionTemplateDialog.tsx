import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
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
  selectedTemplateSignatures?: string[]
  initialMode?: 'list' | 'create'
  initialTemplateId?: number | null
}

function createInstructionTemplateSignature(title: string, content: string): string {
  const normalizedTitle = title.replace(/\s+/g, ' ').trim().toLowerCase()
  const normalizedContent = content.replace(/\s+/g, ' ').trim().toLowerCase()
  return `${normalizedTitle}::${normalizedContent}`
}

function InstructionTemplateDialog({
  open,
  authToken,
  mode,
  onClose,
  onSelectTemplate,
  selectedTemplateSignatures = [],
  initialMode = 'list',
  initialTemplateId = null,
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
  const [templateMenuAnchorEl, setTemplateMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [templateMenuTemplateId, setTemplateMenuTemplateId] = useState<number | null>(null)
  const [hasAppliedInitialAction, setHasAppliedInitialAction] = useState(false)

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
      setTemplateMenuAnchorEl(null)
      setTemplateMenuTemplateId(null)
      setHasAppliedInitialAction(false)
      return
    }
    setHasAppliedInitialAction(false)
    void loadTemplates()
  }, [loadTemplates, open])

  const sortedTemplates = useMemo(
    () =>
      templates
        .filter((item): item is StoryInstructionTemplate => Boolean(item) && typeof item.id === 'number')
        .sort((left, right) => left.id - right.id),
    [templates],
  )
  const selectedTemplateSignatureSet = useMemo(
    () => new Set(selectedTemplateSignatures.map((signature) => signature.trim()).filter(Boolean)),
    [selectedTemplateSignatures],
  )
  const selectedTemplateMenuItem = useMemo(
    () =>
      templateMenuTemplateId !== null
        ? sortedTemplates.find((template) => template.id === templateMenuTemplateId) ?? null
        : null,
    [sortedTemplates, templateMenuTemplateId],
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

  const handleOpenEditEditor = useCallback((template: StoryInstructionTemplate) => {
    if (isBusy) {
      return
    }
    setErrorMessage('')
    setEditingTemplateId(template.id)
    setTemplateTitleDraft(template.title)
    setTemplateContentDraft(template.content)
    setIsEditorOpen(true)
  }, [isBusy])

  const handleCloseEditor = () => {
    if (isBusy) {
      return
    }
    setIsEditorOpen(false)
    setEditingTemplateId(null)
    setTemplateTitleDraft('')
    setTemplateContentDraft('')
  }

  const handleOpenTemplateMenu = useCallback((event: ReactMouseEvent<HTMLElement>, templateId: number) => {
    event.stopPropagation()
    setTemplateMenuAnchorEl(event.currentTarget)
    setTemplateMenuTemplateId(templateId)
  }, [])

  const handleCloseTemplateMenu = useCallback(() => {
    setTemplateMenuAnchorEl(null)
    setTemplateMenuTemplateId(null)
  }, [])

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
      const templateSignature = createInstructionTemplateSignature(template.title, template.content)
      if (selectedTemplateSignatureSet.has(templateSignature)) {
        setErrorMessage('Этот шаблон уже добавлен.')
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
    [isBusy, onClose, onSelectTemplate, selectedTemplateSignatureSet],
  )

  const handleEditTemplateFromMenu = useCallback(() => {
    if (!selectedTemplateMenuItem || isBusy) {
      return
    }
    handleOpenEditEditor(selectedTemplateMenuItem)
    handleCloseTemplateMenu()
  }, [handleCloseTemplateMenu, handleOpenEditEditor, isBusy, selectedTemplateMenuItem])

  const handleDeleteTemplateFromMenu = useCallback(async () => {
    if (!selectedTemplateMenuItem || isBusy) {
      return
    }
    handleCloseTemplateMenu()
    await handleDeleteTemplate(selectedTemplateMenuItem.id)
  }, [handleCloseTemplateMenu, handleDeleteTemplate, isBusy, selectedTemplateMenuItem])

  const renderCreatePlaceholderCard = (options: { onClick: () => void }) => (
    <ButtonBase
      onClick={options.onClick}
      disabled={isBusy}
      aria-label="Create template"
      sx={{
        width: '100%',
        minHeight: 68,
        borderRadius: '12px',
        border: 'var(--morius-border-width) dashed rgba(203, 217, 236, 0.46)',
        backgroundColor: 'rgba(116, 140, 171, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--morius-text-primary)',
        transition: 'background-color 180ms ease, border-color 180ms ease',
        '&:hover': {
          backgroundColor: 'rgba(129, 151, 182, 0.14)',
          borderColor: 'rgba(203, 217, 236, 0.7)',
        },
      }}
    >
      <Box
        sx={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: 'var(--morius-border-width) solid rgba(214, 226, 241, 0.62)',
          display: 'grid',
          placeItems: 'center',
          fontSize: '1.42rem',
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        +
      </Box>
    </ButtonBase>
  )

  useEffect(() => {
    if (!open || isLoadingTemplates || hasAppliedInitialAction || isBusy) {
      return
    }

    if (initialTemplateId !== null) {
      const targetTemplate = sortedTemplates.find((template) => template.id === initialTemplateId) ?? null
      if (targetTemplate) {
        setErrorMessage('')
        setEditingTemplateId(targetTemplate.id)
        setTemplateTitleDraft(targetTemplate.title)
        setTemplateContentDraft(targetTemplate.content)
        setIsEditorOpen(true)
      }
      setHasAppliedInitialAction(true)
      return
    }

    if (initialMode === 'create') {
      setErrorMessage('')
      setEditingTemplateId(null)
      setTemplateTitleDraft('')
      setTemplateContentDraft('')
      setIsEditorOpen(true)
      setHasAppliedInitialAction(true)
      return
    }

    setHasAppliedInitialAction(true)
  }, [
    hasAppliedInitialAction,
    initialMode,
    initialTemplateId,
    isBusy,
    isLoadingTemplates,
    open,
    sortedTemplates,
  ])

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
          <Stack spacing={0.9}>
            {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

            {renderCreatePlaceholderCard({ onClick: handleOpenCreateEditor })}

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
                  px: 1.05,
                  py: 0.95,
                }}
              >
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.87rem' }}>
                  Пока нет сохраненных шаблонов.
                </Typography>
              </Box>
            ) : (
              <Box className="morius-scrollbar" sx={{ maxHeight: 352, overflowY: 'auto', pr: 0.25 }}>
                <Stack spacing={0.6}>
                  {sortedTemplates.map((template) => {
                    const templateSignature = createInstructionTemplateSignature(template.title, template.content)
                    const isTemplateSelected = mode === 'picker' && selectedTemplateSignatureSet.has(templateSignature)
                    const isTemplateDisabled = isBusy || (mode === 'picker' && (!onSelectTemplate || isTemplateSelected))
                    const isTemplateApplying = applyingTemplateId === template.id

                    const cardBody = (
                      <Stack spacing={0.46} sx={{ width: '100%' }}>
                        <Stack direction="row" spacing={0.6} alignItems="flex-start" justifyContent="space-between">
                          <Typography
                            sx={{
                              color: 'var(--morius-text-primary)',
                              fontSize: '0.93rem',
                              fontWeight: 700,
                              lineHeight: 1.23,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              minWidth: 0,
                              flex: 1,
                            }}
                          >
                            {template.title}
                          </Typography>
                          {mode === 'manage' ? (
                            <IconButton
                              onClick={(event) => handleOpenTemplateMenu(event, template.id)}
                              disabled={isBusy}
                              sx={{
                                width: 26,
                                height: 26,
                                color: 'rgba(208, 219, 235, 0.84)',
                                flexShrink: 0,
                                backgroundColor: 'transparent !important',
                                border: 'none',
                                '&:hover': { backgroundColor: 'transparent !important' },
                                '&:active': { backgroundColor: 'transparent !important' },
                                '&.Mui-focusVisible': { backgroundColor: 'transparent !important' },
                              }}
                            >
                              {deletingTemplateId === template.id ? (
                                <CircularProgress size={13} sx={{ color: 'rgba(208, 219, 235, 0.84)' }} />
                              ) : (
                                <Box sx={{ fontSize: '0.96rem', lineHeight: 1 }}>...</Box>
                              )}
                            </IconButton>
                          ) : isTemplateApplying ? (
                            <CircularProgress size={13} sx={{ color: 'rgba(208, 219, 235, 0.84)' }} />
                          ) : null}
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
                          {template.content}
                        </Typography>
                        {mode === 'picker' ? (
                          <Typography
                            sx={{
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              color: isTemplateSelected ? 'rgba(238, 198, 142, 0.94)' : 'rgba(181, 199, 220, 0.82)',
                            }}
                          >
                            {isTemplateSelected ? 'Уже выбрано' : 'Нажмите для выбора'}
                          </Typography>
                        ) : null}
                      </Stack>
                    )

                    if (mode === 'picker') {
                      return (
                        <ButtonBase
                          key={template.id}
                          onClick={() => void handleApplyTemplate(template)}
                          disabled={isTemplateDisabled}
                          sx={{
                            width: '100%',
                            borderRadius: '12px',
                            border: isTemplateSelected
                              ? 'var(--morius-border-width) solid rgba(226, 188, 141, 0.55)'
                              : 'var(--morius-border-width) solid var(--morius-card-border)',
                            backgroundColor: isTemplateSelected
                              ? 'rgba(137, 106, 69, 0.14)'
                              : 'var(--morius-elevated-bg)',
                            px: 0.95,
                            py: 0.75,
                            textAlign: 'left',
                            alignItems: 'stretch',
                            transition: 'background-color 180ms ease, border-color 180ms ease',
                            opacity: isTemplateDisabled && !isTemplateSelected ? 0.62 : 1,
                            '&:hover': {
                              backgroundColor: isTemplateSelected
                                ? 'rgba(137, 106, 69, 0.14)'
                                : 'var(--morius-button-hover)',
                            },
                          }}
                        >
                          {cardBody}
                        </ButtonBase>
                      )
                    }

                    return (
                      <Box
                        key={template.id}
                        sx={{
                          width: '100%',
                          borderRadius: '12px',
                          border: 'var(--morius-border-width) solid var(--morius-card-border)',
                          backgroundColor: 'var(--morius-elevated-bg)',
                          px: 0.95,
                          py: 0.75,
                        }}
                      >
                        {cardBody}
                      </Box>
                    )
                  })}
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
        <Menu
          anchorEl={templateMenuAnchorEl}
          open={mode === 'manage' && Boolean(templateMenuAnchorEl && selectedTemplateMenuItem)}
          onClose={handleCloseTemplateMenu}
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
            onClick={handleEditTemplateFromMenu}
            disabled={!selectedTemplateMenuItem || isBusy}
            sx={{ color: 'rgba(220, 231, 245, 0.92)', fontSize: '0.9rem' }}
          >
            <Stack direction="row" spacing={0.7} alignItems="center">
              <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>?</Box>
              <Box component="span">Редактировать</Box>
            </Stack>
          </MenuItem>
          <MenuItem
            onClick={() => void handleDeleteTemplateFromMenu()}
            disabled={!selectedTemplateMenuItem || isBusy}
            sx={{ color: 'rgba(248, 176, 176, 0.94)', fontSize: '0.9rem' }}
          >
            <Stack direction="row" spacing={0.7} alignItems="center">
              <Box sx={{ fontSize: '0.92rem', lineHeight: 1 }}>?</Box>
              <Box component="span">Удалить</Box>
            </Stack>
          </MenuItem>
        </Menu>
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





