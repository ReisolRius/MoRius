import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, SvgIcon, type DialogProps, type SxProps, type Theme } from '@mui/material'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefCallback } from 'react'
import useMobileDialogSheet from './useMobileDialogSheet'

type BaseDialogActionContext = {
  requestClose: () => void
}

type BaseDialogProps = {
  open: boolean
  onClose: () => void
  header?: ReactNode
  actions?: ReactNode | ((context: BaseDialogActionContext) => ReactNode)
  children: ReactNode
  maxWidth?: DialogProps['maxWidth']
  fullWidth?: boolean
  transitionComponent?: DialogProps['TransitionComponent']
  backdropSx?: SxProps<Theme>
  rawChildren?: boolean
  paperSx?: SxProps<Theme>
  titleSx?: SxProps<Theme>
  contentSx?: SxProps<Theme>
  actionsSx?: SxProps<Theme>
  showCloseButton?: boolean
  disableBackdropClose?: boolean
  protectTextInputClose?: boolean
  hasUnsavedChanges?: boolean
  confirmCloseTitle?: string
  confirmCloseDescription?: string
  confirmCloseConfirmLabel?: string
  confirmCloseCancelLabel?: string
}

const editableTextSelector = [
  'textarea:not([disabled]):not([readonly])',
  'input:not([type="hidden"]):not([disabled]):not([readonly])',
  '[contenteditable="true"]',
  '[role="textbox"]',
].join(',')

function isEditableTextTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(editableTextSelector))
}

const defaultPaperSx = {
  borderRadius: 'var(--morius-radius)',
  border: 'var(--morius-border-width) solid var(--morius-card-border)',
  background: 'var(--morius-dialog-bg)',
  boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
} as const

const defaultTitleSx = {
  px: 'var(--morius-content-gap)',
  pt: 'var(--morius-title-top-gap)',
  pb: 'var(--morius-title-bottom-gap)',
} as const

const defaultContentSxWithHeader = {
  px: 'var(--morius-content-gap)',
  pt: 0,
  pb: 'var(--morius-content-gap)',
} as const

const defaultContentSxWithoutHeader = {
  px: 'var(--morius-content-gap)',
  pt: 'var(--morius-content-gap)',
  pb: 'var(--morius-content-gap)',
} as const

const defaultActionsSx = {
  px: 'var(--morius-content-gap)',
  pb: 'var(--morius-content-gap)',
  pt: 0,
  columnGap: 'var(--morius-content-gap)',
} as const

function flattenSx(parts: Array<SxProps<Theme> | undefined>): SxProps<Theme> {
  const flattened = parts.flatMap((part) => {
    if (!part) {
      return []
    }
    return Array.isArray(part) ? part : [part]
  })

  return flattened.length === 1 ? flattened[0] : flattened
}

function BaseDialog({
  open,
  onClose,
  header,
  actions,
  children,
  maxWidth = 'sm',
  fullWidth = true,
  transitionComponent,
  backdropSx,
  rawChildren = false,
  paperSx,
  titleSx,
  contentSx,
  actionsSx,
  showCloseButton = true,
  disableBackdropClose = false,
  protectTextInputClose = true,
  hasUnsavedChanges = false,
  confirmCloseTitle = 'Закрыть без сохранения?',
  confirmCloseDescription = 'Внесенные изменения будут потеряны.',
  confirmCloseConfirmLabel = 'Закрыть',
  confirmCloseCancelLabel = 'Остаться',
}: BaseDialogProps) {
  const [isConfirmCloseOpen, setIsConfirmCloseOpen] = useState(false)
  const [hasUserInputChanges, setHasUserInputChanges] = useState(false)
  const paperRef = useRef<HTMLElement | null>(null)

  const hasProtectedUnsavedChanges = hasUnsavedChanges || (protectTextInputClose && hasUserInputChanges)
  const dialogHasTextInputs = () => protectTextInputClose && Boolean(paperRef.current?.querySelector(editableTextSelector))

  const handleRequestClose = useCallback(() => {
    if (hasProtectedUnsavedChanges) {
      setIsConfirmCloseOpen(true)
      return
    }
    onClose()
  }, [hasProtectedUnsavedChanges, onClose])

  const handleDialogInputCapture = (event: FormEvent<HTMLElement>) => {
    if (protectTextInputClose && isEditableTextTarget(event.target)) {
      setHasUserInputChanges(true)
    }
  }

  const handleDialogClose: DialogProps['onClose'] = (_event, reason) => {
    if (reason === 'backdropClick' && (disableBackdropClose || dialogHasTextInputs())) {
      return
    }
    handleRequestClose()
  }

  useEffect(() => {
    if (!open) {
      setIsConfirmCloseOpen(false)
      setHasUserInputChanges(false)
    }
  }, [open])

  const mobileSheet = useMobileDialogSheet({ onClose: handleRequestClose })
  const mobileSheetPaperRef = mobileSheet.paperTouchHandlers.ref
  const setPaperRef = useCallback<RefCallback<HTMLElement>>(
    (node) => {
      paperRef.current = node
      mobileSheetPaperRef?.(node)
    },
    [mobileSheetPaperRef],
  )
  const mergedPaperSx = flattenSx([defaultPaperSx, paperSx, mobileSheet.paperSx])
  const mergedTitleSx = flattenSx([defaultTitleSx, titleSx])
  const contentBaseSx = header ? defaultContentSxWithHeader : defaultContentSxWithoutHeader
  const mergedContentSx = flattenSx([contentBaseSx, contentSx])
  const mergedActionsSx = flattenSx([defaultActionsSx, actionsSx])
  const mergedBackdropSx = flattenSx([mobileSheet.backdropSx, backdropSx])

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      TransitionComponent={transitionComponent}
      sx={{
        ...mobileSheet.dialogSx,
        '& .MuiButton-root': {
          border: 'none !important',
          backgroundColor: 'transparent !important',
          boxShadow: 'none !important',
        },
        '& .MuiButton-root:hover, & .MuiButton-root:active, & .MuiButton-root.Mui-focusVisible': {
          backgroundColor: 'transparent !important',
          boxShadow: 'none !important',
        },
        '& .MuiIconButton-root': {
          border: 'none !important',
          backgroundColor: 'transparent !important',
          boxShadow: 'none !important',
        },
        '& .MuiIconButton-root:hover, & .MuiIconButton-root:active, & .MuiIconButton-root.Mui-focusVisible': {
          backgroundColor: 'transparent !important',
          boxShadow: 'none !important',
        },
      }}
      BackdropProps={{
        sx: mergedBackdropSx,
      }}
      PaperProps={{
        ref: setPaperRef,
        onInputCapture: handleDialogInputCapture,
        sx: mergedPaperSx,
      }}
    >
      {showCloseButton && !mobileSheet.isMobileSheet ? (
        <IconButton
          aria-label="Закрыть"
          onClick={handleRequestClose}
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 2,
            width: 34,
            height: 34,
            borderRadius: '999px',
            color: 'var(--morius-text-secondary)',
            '&:hover': {
              color: 'var(--morius-text-primary)',
            },
          }}
        >
          <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
            <path d="M6.7 6.7a1 1 0 0 1 1.4 0L12 10.6l3.9-3.9a1 1 0 1 1 1.4 1.4L13.4 12l3.9 3.9a1 1 0 0 1-1.4 1.4L12 13.4l-3.9 3.9a1 1 0 0 1-1.4-1.4l3.9-3.9-3.9-3.9a1 1 0 0 1 0-1.4" fill="currentColor" />
          </SvgIcon>
        </IconButton>
      ) : null}
      {rawChildren ? (
        children
      ) : (
        <>
          {header ? <DialogTitle sx={mergedTitleSx}>{header}</DialogTitle> : null}
          <DialogContent sx={mergedContentSx}>{children}</DialogContent>
          {actions ? (
            <DialogActions sx={mergedActionsSx}>
              {typeof actions === 'function' ? actions({ requestClose: handleRequestClose }) : actions}
            </DialogActions>
          ) : null}
        </>
      )}
      <Dialog
        open={isConfirmCloseOpen}
        onClose={() => setIsConfirmCloseOpen(false)}
        maxWidth="xs"
        fullWidth
        BackdropProps={{
          sx: { backgroundColor: 'rgba(0,0,0,0.62)' },
        }}
        PaperProps={{
          sx: {
            borderRadius: 'var(--morius-radius)',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            background: 'var(--morius-dialog-bg)',
            color: 'var(--morius-text-primary)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>{confirmCloseTitle}</DialogTitle>
        <DialogContent sx={{ color: 'var(--morius-text-secondary)', pt: 0.5 }}>
          {confirmCloseDescription}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2 }}>
          <Button onClick={() => setIsConfirmCloseOpen(false)} sx={{ color: 'var(--morius-text-secondary)' }}>
            {confirmCloseCancelLabel}
          </Button>
          <Button
            onClick={() => {
              setIsConfirmCloseOpen(false)
              onClose()
            }}
            sx={{ color: 'var(--morius-title-text)' }}
          >
            {confirmCloseConfirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}

export default BaseDialog
