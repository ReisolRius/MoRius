import { Dialog, DialogActions, DialogContent, DialogTitle, type DialogProps, type SxProps, type Theme } from '@mui/material'
import type { ReactNode } from 'react'

type BaseDialogProps = {
  open: boolean
  onClose: () => void
  header?: ReactNode
  actions?: ReactNode
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
}

const defaultPaperSx = {
  borderRadius: 'var(--morius-radius)',
  border: 'var(--morius-border-width) solid var(--morius-card-border)',
  background: 'var(--morius-card-bg)',
  boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
} as const

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
}: BaseDialogProps) {
  const mergedPaperSx = paperSx ? ([defaultPaperSx, paperSx] as SxProps<Theme>) : defaultPaperSx

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      TransitionComponent={transitionComponent}
      BackdropProps={backdropSx ? { sx: backdropSx } : undefined}
      PaperProps={{ sx: mergedPaperSx }}
    >
      {rawChildren ? (
        children
      ) : (
        <>
          {header ? <DialogTitle sx={titleSx}>{header}</DialogTitle> : null}
          <DialogContent sx={contentSx}>{children}</DialogContent>
          {actions ? <DialogActions sx={actionsSx}>{actions}</DialogActions> : null}
        </>
      )}
    </Dialog>
  )
}

export default BaseDialog
