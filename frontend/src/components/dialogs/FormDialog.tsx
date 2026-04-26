import { Button, Stack, Typography, type DialogProps, type SxProps, type Theme } from '@mui/material'
import type { ReactNode } from 'react'
import BaseDialog from './BaseDialog'

type FormDialogProps = {
  open: boolean
  onClose: () => void
  onSubmit: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  submitLabel?: string
  cancelLabel?: string
  submitDisabled?: boolean
  maxWidth?: DialogProps['maxWidth']
  paperSx?: SxProps<Theme>
  titleSx?: SxProps<Theme>
  contentSx?: SxProps<Theme>
  actionsSx?: SxProps<Theme>
  cancelButtonSx?: SxProps<Theme>
  submitButtonSx?: SxProps<Theme>
  hasUnsavedChanges?: boolean
  disableBackdropClose?: boolean
}

function FormDialog({
  open,
  onClose,
  onSubmit,
  title,
  description,
  children,
  submitLabel = 'Сохранить',
  cancelLabel = 'Отмена',
  submitDisabled = false,
  maxWidth = 'sm',
  paperSx,
  titleSx,
  contentSx,
  actionsSx,
  cancelButtonSx,
  submitButtonSx,
  hasUnsavedChanges = false,
  disableBackdropClose = true,
}: FormDialogProps) {
  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      paperSx={paperSx}
      titleSx={titleSx}
      contentSx={contentSx}
      actionsSx={actionsSx}
      disableBackdropClose={disableBackdropClose}
      hasUnsavedChanges={hasUnsavedChanges}
      header={
        <Stack spacing={0.3}>
          {typeof title === 'string' ? <Typography sx={{ fontWeight: 800, fontSize: '1.45rem' }}>{title}</Typography> : title}
          {description ? (
            typeof description === 'string' ? (
              <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>{description}</Typography>
            ) : (
              description
            )
          ) : null}
        </Stack>
      }
      actions={({ requestClose }) => (
        <>
          <Button onClick={requestClose} sx={cancelButtonSx}>
            {cancelLabel}
          </Button>
          <Button onClick={onSubmit} disabled={submitDisabled} sx={submitButtonSx}>
            {submitLabel}
          </Button>
        </>
      )}
    >
      {children}
    </BaseDialog>
  )
}

export default FormDialog
